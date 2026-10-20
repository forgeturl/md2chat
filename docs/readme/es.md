# md2chat — Markdown listo para el chat

[简体中文](../../README.md) · [English](en.md) · [Español](es.md) · [Português](pt-BR.md) · [日本語](ja.md) · [한국어](ko.md) · [Deutsch](de.md) · [Français](fr.md) · [हिन्दी](hi.md)

<!-- language: es; source-sha256: 62acd6d3ecd00f7506d3cd1d28b689f2011e22c6b61c1eeeff69038b83fab54d -->

Convierte Markdown de herramientas de IA o de tus propios documentos en texto e imágenes para el chat. El texto normal sigue siendo editable; tablas, código, fórmulas y diagramas Mermaid se convierten en imágenes conservando el orden. Las tareas usan ✅ / ⬜. Los nombres de herramientas de IA indican posibles fuentes de contenido, no integraciones oficiales ni compatibilidad verificada.

[Sitio web](https://forgeturl.github.io/md2chat/es/) · [Editor web](https://forgeturl.github.io/md2chat/editor.html?lang=es) · [Última versión](https://github.com/forgeturl/md2chat/releases/latest) · [Pruebas de compatibilidad](../compatibility.md)

![Vista de escritorio](../desktop-preview.png)

## Descarga

- [DMG universal para macOS — Apple Silicon e Intel](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-mac-universal.dmg)
- [Instalador Windows x64 — Intel y AMD](https://github.com/forgeturl/md2chat/releases/latest/download/md2chat-windows-x64-setup.exe)
- [Sumas SHA256](https://github.com/forgeturl/md2chat/releases/latest/download/SHA256SUMS.txt)

Los enlaces apuntan siempre a la última versión. Para instalar en Mac usa el DMG; `.app.tar.gz` es para actualizaciones internas. No hay paquete nativo para Windows ARM. El escritorio usa Tauri 2, Rust y el WebView del sistema, sin incluir Electron ni Node.js. Windows instala WebView2 mediante Internet si falta. Las versiones oficiales de Mac requieren firma Developer ID y notarización; Windows aún no usa firma Authenticode. No se migran automáticamente las instalaciones antiguas de Electron.

## Uso

Pega Markdown, texto o imágenes a la izquierda, revisa la vista previa, elige el destino y pega en esa aplicación. Vaciar inicia un documento sin contenido. La web desactiva la copia para DingTalk y Feishu; usa la aplicación de escritorio.

- **WeChat:** texto e imágenes estándar; comprueba que no falten imágenes.
- **DingTalk:** formato nativo en Mac, HTML y texto alternativo en Windows. Las pruebas históricas de Mac no validan todos los clientes actuales; Windows necesita pruebas en el cliente.
- **Feishu/Lark:** despliega primero el editor enriquecido de Mac. La mezcla de texto e imágenes y el envío se probaron en Mac; Windows sigue siendo experimental.
- **WeCom:** Mac y Windows pegan texto e imágenes juntos; la web usa partes ordenadas. Las pruebas de formato en Windows 5.0.12.6018 conservaron dos imágenes, chino y numeración, pero eliminaron negrita, tamaños y colores. Las pruebas también pasaron el envío al Asistente de transferencia de archivos; falta validar la nueva compilación Windows.
- **Correo:** tablas HTML editables y contenido complejo como imágenes. Experimental: verifica las imágenes después de pegar y enviar.

El escritorio también convierte el documento completo en un PNG blanco; el texto de la imagen no es editable. Los contenidos largos pueden reducirse o superar los límites. Si el portapapeles cambia durante la conversión, se conserva el contenido nuevo y se pide reintentar. Admite rutas absolutas e imágenes `file:///` locales tras validarlas: PNG, JPEG, GIF, WebP o BMP, hasta 10 MB y 20 millones de píxeles por imagen. En la web, pega las imágenes directamente. Nunca envía mensajes automáticamente.

## Bandeja y atajos

La barra de Mac o bandeja de Windows permite convertir el portapapeles sin cambiar el editor, abrir la ventana y Preferencias, buscar actualizaciones o salir completamente. Cerrar la ventana conserva el proceso y el texto en memoria. En Preferencias puedes fijar y ordenar formatos, activar el inicio de sesión y configurar atajos globales de conversión. Los atajos y el inicio automático requieren activación explícita; en Mac instala antes en Aplicaciones. La bandeja y el inicio de Windows aún requieren pruebas en un dispositivo real.

## Idiomas y actualizaciones

Interfaz, ejemplos, sitio, README y resúmenes de versiones admiten nueve idiomas. El menú del globo muestra los nombres originales. Los ejemplos sin editar cambian con el idioma; al editar, pegar, soltar o vaciar se conserva el contenido del usuario, incluso después de deshacer.

Los resúmenes incluyen las versiones publicadas entre la instalada y la de destino. Se muestran primero las tres más recientes, las demás se pueden desplegar y los avisos importantes permanecen visibles. Las notas técnicas conservan su idioma original. Se buscan actualizaciones al iniciar y cada seis horas; descargar y reiniciar requieren una acción del usuario. Guarda el contenido antes de instalar. Los clientes antiguos reciben la interfaz nueva al instalar una versión que la incluya; la instalación entre versiones requiere pruebas con paquetes firmados.

Los resúmenes históricos se cargan y guardan en caché según el idioma y el intervalo de actualización. Si fallan, se mantiene el resumen actual y se permite descargar el instalador. Cierra y vuelve a abrir el diálogo para reintentar; el historial cargado correctamente se reutiliza desde la caché. Los clientes antiguos siguen leyendo el campo compatible `notes`.

## Privacidad y diagnóstico

Sin cuenta ni subida de contenido a md2chat. La conversión es local; las imágenes remotas contactan su servidor de origen. El escritorio puede almacenar imágenes localmente para permitir el pegado posterior. El texto no se guarda de forma persistente: salir completamente o recargar lo elimina.

El diagnóstico lee solo a petición. El ZIP exportado contiene datos originales, texto, imágenes, enlaces y posibles formatos privados: revísalo antes de compartir. Cerrar el diagnóstico borra la muestra. No hay subida automática; el enlace de incidencias abre GitHub para adjuntar el ZIP manualmente. Las solicitudes de actualización no incluyen el documento.

## Desarrollo

Node.js 22.12+ y Rust 1.90+. Mac requiere Xcode Command Line Tools; Windows, herramientas Visual Studio C++ y WebView2. Genera cada instalador en su sistema. El DMG oficial también requiere Python 3.10+ y las dependencias verificadas de `scripts/dmgbuild-requirements.txt`.

```sh
npm ci
npm run dev
npm run desktop
npm run check
npm run build
npm run desktop:test
npm run desktop:test:render
npm run desktop:test:native
npm run desktop:test:windows
npm run desktop:dist:mac
npm run desktop:dist:win
```

Las pruebas nativas reemplazan temporalmente el portapapeles y lo restauran; ejecútalas cuando no lo uses. Las pruebas web o de formato no equivalen a validar el pegado en clientes reales. Solo las páginas locales empaquetadas pueden usar los comandos de escritorio restringidos; el WebView no expone Node.js.

## Contribuciones y publicación

Sigue la [norma de idiomas](../localization.md), sincronizando los nueve idiomas en cambios visibles. Ejecuta `npm run seo:generate` tras cambiar páginas o recursos y `npm run check` antes de confirmar. Las páginas traducidas se agrupan en `site/locales/`, manteniendo las URL públicas existentes. Este directorio contiene ocho traducciones del README; el principal está en chino. Los registros técnicos pueden conservar su idioma original.

Prepara notas detalladas y un resumen en nueve idiomas:

```sh
npm run release:prepare -- patch --notes-file /tmp/md2chat-release-notes.md --summary-file /tmp/md2chat-update-summary.json
npm run release:verify -- --tag vX.Y.Z
```

Revisa los archivos, ejecuta las comprobaciones y `npm run release:verify -- --tag vX.Y.Z`. Preparar no confirma ni publica. Solo una petición explícita de publicación autoriza crear y enviar la etiqueta. Los cambios en main o PR no publican; existe un flujo independiente para el sitio. La publicación oficial valida paquetes y firmas, publica GitHub Release y después despliega el sitio de la misma versión. El flujo manual de escritorio solo genera paquetes de prueba, sin actualización interna ni publicación. Consulta [firmas y publicación](../auto-update.md), [resúmenes](../update-summaries.md), [validación Windows](../windows-clipboard-qa.md) y la [referencia detallada](../../README.md#发布).

Usa ejemplos ficticios. No subas mensajes privados, muestras del portapapeles, credenciales o capturas personales. [Licencia MIT](../../LICENSE) · [Avisos de terceros](../../THIRD_PARTY_NOTICES.md).
