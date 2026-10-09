# 一段彩色 JavaScript

用 `js` 或 `javascript` 标注代码块，关键词、函数和注释会自动着色。

```js
// 挑选值得分享的书籍
const books = [
  { title: "星空漫游", rating: 4.8 },
  { title: "花园笔记", rating: 4.2 },
];

function recommendBooks(items, minimum = 4.5) {
  return items
    .filter(book => book.rating >= minimum)
    .map(({ title }) => `推荐阅读：《${title}》`);
}

console.log(recommendBooks(books));
```

正文仍保留为文字，代码转换为带颜色的图片。
