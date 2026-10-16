<#
.SYNOPSIS
Read the Windows HTML Format clipboard allocation and emit metadata-only JSON.
.DESCRIPTION
This probe does not change the clipboard or return clipboard content. It reads
at most 8 MiB. Native failures have a fixed status and exit code 1; an absent
HTML format and successfully inspected (even invalid) CF_HTML exit with code 0.
.EXAMPLE
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\inspect-windows-clipboard.ps1
.EXAMPLE
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File .\scripts\inspect-windows-clipboard.ps1 -SelfTest
#>
[CmdletBinding()]
param([switch]$SelfTest)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $false

try {
    Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class Md2ChatClipboardOffsets {
    public long? startHtml;
    public long? endHtml;
    public long? startFragment;
    public long? endFragment;
}

public sealed class Md2ChatFragmentMarkers {
    public bool startPresent;
    public bool endPresent;
}

public sealed class Md2ChatClipboardHtmlReport {
    public int schemaVersion = 1;
    public bool present;
    public string status = "no_html";
    public long byteLength;
    public int contentByteLength;
    public string version;
    public bool sourceUrlPresent;
    public bool headerValid;
    public Md2ChatClipboardOffsets offsets = new Md2ChatClipboardOffsets();
    public bool validOffsets;
    public bool validUtf8;
    public bool validUtf8Boundaries;
    public Md2ChatFragmentMarkers fragmentMarkers = new Md2ChatFragmentMarkers();
    public bool fragmentMarkersMatch;
}

public sealed class Md2ChatClipboardProbeSelfTest {
    public int schemaVersion = 1;
    public string status = "self_test_passed";
    public int passed;
}

public static class Md2ChatWindowsClipboardProbe {
    private const int MaxBytes = 8 * 1024 * 1024;
    private const int MaxHeaderBytes = 64 * 1024;
    private static readonly Encoding StrictUtf8 = new UTF8Encoding(false, true);
    private static readonly byte[] StartMarker = Encoding.ASCII.GetBytes("<!--StartFragment-->");
    private static readonly byte[] EndMarker = Encoding.ASCII.GetBytes("<!--EndFragment-->");

    [DllImport("user32.dll", EntryPoint = "RegisterClipboardFormatW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseClipboard();
    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsClipboardFormatAvailable(uint format);
    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetClipboardData(uint format);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GlobalLock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GlobalUnlock(IntPtr handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern UIntPtr GlobalSize(IntPtr handle);

    public static Md2ChatClipboardHtmlReport Inspect() {
        var report = new Md2ChatClipboardHtmlReport();
        if (Environment.OSVersion.Platform != PlatformID.Win32NT) {
            report.status = "unsupported_platform";
            return report;
        }
        uint format = RegisterClipboardFormat("HTML Format");
        if (format == 0) {
            report.status = "register_failed";
            return report;
        }
        bool opened = false;
        // Six attempts and five 20 ms waits bound clipboard lock contention.
        for (int attempt = 0; attempt < 6; attempt++) {
            if (OpenClipboard(IntPtr.Zero)) { opened = true; break; }
            if (attempt < 5) Thread.Sleep(20);
        }
        if (!opened) {
            report.status = "open_failed";
            return report;
        }
        IntPtr handle = IntPtr.Zero;
        bool locked = false;
        try {
            if (!IsClipboardFormatAvailable(format)) return report;
            report.present = true;
            handle = GetClipboardData(format);
            if (handle == IntPtr.Zero) { report.status = "data_failed"; return report; }
            ulong size = GlobalSize(handle).ToUInt64();
            report.byteLength = size <= (ulong)Int64.MaxValue ? (long)size : Int64.MaxValue;
            if (size == 0) { report.status = "size_failed"; return report; }
            if (size > MaxBytes) { report.status = "oversized"; return report; }
            IntPtr memory = GlobalLock(handle);
            if (memory == IntPtr.Zero) { report.status = "lock_failed"; return report; }
            locked = true;
            var bytes = new byte[(int)size];
            Marshal.Copy(memory, bytes, 0, bytes.Length);
            return Parse(bytes);
        }
        finally {
            // A false GlobalUnlock return can mean the lock count reached zero.
            if (locked) GlobalUnlock(handle);
            CloseClipboard();
        }
    }

    private static bool HeaderName(string name) {
        if (name.Length == 0 || name.Length > 64) return false;
        foreach (char c in name) {
            if (!((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                  (c >= '0' && c <= '9') || c == '-')) return false;
        }
        return true;
    }

    private static bool VersionNumber(string value) {
        int dot = value.IndexOf('.');
        if (dot < 1 || dot > 3 || value.Length - dot - 1 < 1 || value.Length - dot - 1 > 3) return false;
        for (int i = 0; i < value.Length; i++) {
            if (i != dot && (value[i] < '0' || value[i] > '9')) return false;
        }
        return true;
    }

    private static long? Offset(string value) {
        long number;
        return Int64.TryParse(value, NumberStyles.AllowLeadingSign, CultureInfo.InvariantCulture, out number) ? (long?)number : null;
    }

    private static bool Range(long? start, long? end, int length) {
        return start.HasValue && end.HasValue && start.Value >= 0 &&
               start.Value <= end.Value && end.Value <= length;
    }

    private static bool Boundary(byte[] bytes, int offset, int length) {
        return offset == length || offset == 0 || (bytes[offset] & 0xc0) != 0x80;
    }

    private static bool At(byte[] bytes, int offset, byte[] token, int length) {
        if (offset < 0 || offset > length - token.Length) return false;
        for (int i = 0; i < token.Length; i++) if (bytes[offset + i] != token[i]) return false;
        return true;
    }

    private static bool Contains(byte[] bytes, byte[] token, int length) {
        for (int i = 0; i <= length - token.Length; i++) {
            if (bytes[i] == token[0] && At(bytes, i, token, length)) return true;
        }
        return false;
    }

    // Parse only bounded bytes already copied out of the locked allocation.
    // No HTML, header values other than numeric offsets/version, URLs or errors
    // can escape in this return type.
    public static Md2ChatClipboardHtmlReport Parse(byte[] bytes) {
        var report = new Md2ChatClipboardHtmlReport();
        report.present = true;
        report.byteLength = bytes.Length;
        if (bytes.Length > MaxBytes) { report.status = "oversized"; return report; }
        int length = Array.IndexOf(bytes, (byte)0);
        if (length < 0) length = bytes.Length;
        report.contentByteLength = length;
        int cursor = 0, headerEnd = 0, required = 0;
        bool unique = true, versionAtStart = false, versionValid = false;
        bool seenVersion = false, seenStartHtml = false, seenEndHtml = false;
        bool seenStartFragment = false, seenEndFragment = false;
        while (cursor < length && cursor < MaxHeaderBytes) {
            int lineEnd = cursor;
            while (lineEnd < length && lineEnd < MaxHeaderBytes && bytes[lineEnd] != 10) lineEnd++;
            if (lineEnd == length || lineEnd == MaxHeaderBytes) break;
            int valueEnd = lineEnd;
            if (valueEnd > cursor && bytes[valueEnd - 1] == 13) valueEnd--;
            string line = Encoding.ASCII.GetString(bytes, cursor, valueEnd - cursor);
            if (line.Length == 0) { headerEnd = lineEnd + 1; break; }
            int colon = line.IndexOf(':');
            if (colon < 1 || !HeaderName(line.Substring(0, colon))) break;
            string name = line.Substring(0, colon), value = line.Substring(colon + 1).Trim();
            if (name.Equals("Version", StringComparison.OrdinalIgnoreCase)) {
                if (seenVersion) unique = false;
                else { required++; seenVersion = true; versionAtStart = cursor == 0; }
                versionValid = VersionNumber(value);
                report.version = versionValid ? value : "other";
            }
            else if (name.Equals("StartHTML", StringComparison.OrdinalIgnoreCase)) {
                if (seenStartHtml) unique = false; else { required++; seenStartHtml = true; }
                report.offsets.startHtml = Offset(value);
            }
            else if (name.Equals("EndHTML", StringComparison.OrdinalIgnoreCase)) {
                if (seenEndHtml) unique = false; else { required++; seenEndHtml = true; }
                report.offsets.endHtml = Offset(value);
            }
            else if (name.Equals("StartFragment", StringComparison.OrdinalIgnoreCase)) {
                if (seenStartFragment) unique = false; else { required++; seenStartFragment = true; }
                report.offsets.startFragment = Offset(value);
            }
            else if (name.Equals("EndFragment", StringComparison.OrdinalIgnoreCase)) {
                if (seenEndFragment) unique = false; else { required++; seenEndFragment = true; }
                report.offsets.endFragment = Offset(value);
            }
            else if (name.Equals("SourceURL", StringComparison.OrdinalIgnoreCase)) report.sourceUrlPresent = true;
            cursor = lineEnd + 1;
            headerEnd = cursor;
        }
        report.headerValid = required == 5 && unique && versionAtStart && versionValid && headerEnd < MaxHeaderBytes;
        bool noContext = report.offsets.startHtml == -1 && report.offsets.endHtml == -1;
        bool htmlRange = Range(report.offsets.startHtml, report.offsets.endHtml, length);
        bool fragmentRange = Range(report.offsets.startFragment, report.offsets.endFragment, length);
        bool enclosed = noContext || (htmlRange && fragmentRange &&
            report.offsets.startHtml.Value <= report.offsets.startFragment.Value &&
            report.offsets.endFragment.Value <= report.offsets.endHtml.Value);
        bool afterHeader = fragmentRange && report.offsets.startFragment.Value >= headerEnd &&
            (noContext || htmlRange && report.offsets.startHtml.Value >= headerEnd);
        report.validOffsets = report.headerValid && (noContext || htmlRange) && fragmentRange && enclosed && afterHeader;
        try { StrictUtf8.GetCharCount(bytes, 0, length); report.validUtf8 = true; }
        catch (DecoderFallbackException) { report.validUtf8 = false; }
        if (report.validOffsets && report.validUtf8) {
            report.validUtf8Boundaries = Boundary(bytes, (int)report.offsets.startFragment.Value, length) &&
                Boundary(bytes, (int)report.offsets.endFragment.Value, length) && (noContext ||
                Boundary(bytes, (int)report.offsets.startHtml.Value, length) && Boundary(bytes, (int)report.offsets.endHtml.Value, length));
        }
        report.fragmentMarkers.startPresent = Contains(bytes, StartMarker, length);
        report.fragmentMarkers.endPresent = Contains(bytes, EndMarker, length);
        report.fragmentMarkersMatch = report.validOffsets &&
            At(bytes, (int)report.offsets.startFragment.Value - StartMarker.Length, StartMarker, length) &&
            At(bytes, (int)report.offsets.endFragment.Value, EndMarker, length);
        report.status = report.validOffsets && report.validUtf8Boundaries && report.fragmentMarkersMatch ? "ok" : "invalid_cf_html";
        return report;
    }

    private static byte[] Sample(string fragment, bool sourceUrl) {
        const string before = "<html>\r\n<body>\r\n<!--StartFragment-->";
        const string after = "<!--EndFragment-->\r\n</body>\r\n</html>";
        string header = "Version:0.9\r\nStartHTML:{0:D10}\r\nEndHTML:{1:D10}\r\nStartFragment:{2:D10}\r\nEndFragment:{3:D10}\r\n";
        if (sourceUrl) header += "SourceURL:https://example.invalid/private-test-token\r\n";
        int startHtml = Encoding.UTF8.GetByteCount(String.Format(CultureInfo.InvariantCulture, header, 0, 0, 0, 0));
        int startFragment = startHtml + Encoding.UTF8.GetByteCount(before);
        int endFragment = startFragment + Encoding.UTF8.GetByteCount(fragment);
        int endHtml = endFragment + Encoding.UTF8.GetByteCount(after);
        return Encoding.UTF8.GetBytes(String.Format(CultureInfo.InvariantCulture, header, startHtml, endHtml, startFragment, endFragment) + before + fragment + after + "\0");
    }

    private static void ChangeOffset(byte[] bytes, string name, long value) {
        string header = Encoding.ASCII.GetString(bytes, 0, Math.Min(bytes.Length, 512));
        int index = header.IndexOf(name + ":", StringComparison.Ordinal) + name.Length + 1;
        byte[] digits = Encoding.ASCII.GetBytes(value.ToString("D10", CultureInfo.InvariantCulture));
        Array.Copy(digits, 0, bytes, index, digits.Length);
    }

    private static void Require(bool condition) {
        if (!condition) throw new InvalidOperationException("parser_self_test_failed");
    }

    public static Md2ChatClipboardProbeSelfTest SelfTest() {
        var result = new Md2ChatClipboardProbeSelfTest();
        var ascii = Parse(Sample("<p>before</p><img src=\"file:///C:/private/image.png\"><p>after</p>", false));
        Require(ascii.status == "ok" && ascii.version == "0.9" && !ascii.sourceUrlPresent); result.passed++;
        byte[] unicodeBytes = Sample("<p>\u4e2d\u6587 \ud83d\ude00</p>", true);
        var unicode = Parse(unicodeBytes);
        Require(unicode.status == "ok" && unicode.validUtf8Boundaries && unicode.sourceUrlPresent); result.passed++;
        byte[] split = (byte[])unicodeBytes.Clone();
        ChangeOffset(split, "StartFragment", unicode.offsets.startFragment.Value + 4);
        var splitReport = Parse(split);
        Require(splitReport.validOffsets && splitReport.validUtf8 && !splitReport.validUtf8Boundaries); result.passed++;
        byte[] beyond = (byte[])unicodeBytes.Clone();
        ChangeOffset(beyond, "EndHTML", beyond.Length + 1);
        Require(!Parse(beyond).validOffsets); result.passed++;
        byte[] reversed = (byte[])unicodeBytes.Clone();
        ChangeOffset(reversed, "StartFragment", unicode.offsets.endFragment.Value + 1);
        Require(!Parse(reversed).validOffsets); result.passed++;
        byte[] invalidUtf8 = (byte[])unicodeBytes.Clone();
        invalidUtf8[(int)unicode.offsets.startFragment.Value + 3] = 0xff;
        Require(!Parse(invalidUtf8).validUtf8 && !Parse(invalidUtf8).validUtf8Boundaries); result.passed++;
        byte[] marker = (byte[])unicodeBytes.Clone();
        marker[(int)unicode.offsets.startFragment.Value - 1] = (byte)'_';
        Require(!Parse(marker).fragmentMarkersMatch); result.passed++;
        Require(!Parse(Encoding.UTF8.GetBytes("<p>not a clipboard header</p>")).headerValid); result.passed++;
        Require(Parse(new byte[MaxBytes + 1]).status == "oversized"); result.passed++;
        return result;
    }
}
'@ -ErrorAction Stop | Out-Null

    if ($SelfTest) {
        $report = [Md2ChatWindowsClipboardProbe]::SelfTest()
    }
    else {
        $report = [Md2ChatWindowsClipboardProbe]::Inspect()
    }
    [Console]::Out.WriteLine(($report | ConvertTo-Json -Depth 5 -Compress))
    if ($report.status -in @('ok', 'no_html', 'invalid_cf_html', 'self_test_passed')) { exit 0 }
    exit 1
}
catch {
    # Exception messages can contain compiler input, paths or native details.
    # Never pass them to stderr or to the JSON consumed by the smoke test.
    [Console]::Out.WriteLine('{"schemaVersion":1,"present":false,"status":"probe_failed"}')
    exit 1
}
