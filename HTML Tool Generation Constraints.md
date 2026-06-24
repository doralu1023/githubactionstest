# HTML Tool Generation Constraints
# TWEC AI Tool Sandbox — Supplier Specification
# Version: 1.0 | Last updated: 2026-04-14

---

## Overview

This document defines the HTML constraints your AI-generated tool must follow
to be accepted by the TWEC Sandbox platform. Tools that violate these rules
will be automatically sanitized or rejected during the review process.

Feed this document to your AI model **before** generating the HTML tool.

---

## ✅ Allowed

### Tags
All standard HTML tags are allowed, including:
- Layout: `<div>`, `<section>`, `<header>`, `<footer>`, `<main>`, `<nav>`
- Forms: `<form>`, `<input>`, `<button>`, `<select>`, `<textarea>`, `<label>`
- Media: `<img>`, `<canvas>`, `<svg>`, `<video>`, `<audio>`
- Text: `<p>`, `<h1>`–`<h6>`, `<span>`, `<a>`, `<ul>`, `<ol>`, `<li>`, `<table>`
- Style: `<style>` (inline stylesheet)
- Script: `<script>` (inline JavaScript only)

### JavaScript
- Inline `<script>` blocks are fully supported
- All standard browser APIs are available: `document`, `window`, `canvas`, `fetch` (blocked by CSP — see below), `FileReader`, `Blob`, `URL.createObjectURL`
- Event listeners via `addEventListener` are supported
- Inline event attributes (`onclick`, `onchange`, etc.) are supported

### CSS
- Inline `<style>` blocks are fully supported
- All CSS properties and animations are supported
- External Google Fonts via `<link>` are supported (will be bundled at build time)

### External Libraries
You may reference CDN-hosted JavaScript libraries via `<script src="...">`.
They will be automatically downloaded and bundled into the final build.

Recommended and tested libraries:
- `fabric.js` — canvas manipulation
- `html2canvas` — screenshot/export
- `JSZip` — zip file generation
- Any other standard CDN library

---

## ❌ Forbidden

### Tags — will be automatically removed
```
<object>
<embed>
<applet>
<base>
<frame>
<frameset>
<iframe>
```

Do not use these tags. They will be stripped from the tool before review.

### External Connections — blocked by Content Security Policy
The platform enforces the following CSP at runtime:

```
default-src 'unsafe-inline' data: blob:;
connect-src 'none';
```

This means:
- **No external API calls** (`fetch`, `XMLHttpRequest`, `WebSocket` to any URL)
- **No external image loading** via `<img src="https://...">` at runtime
- **No external font loading** at runtime (use `<link>` in `<head>` — it will be bundled)

All data the tool needs must be **self-contained** within the HTML file.

---

## ⚠️ Important Guidelines

### 1. Self-contained HTML
Your tool must work as a **single HTML file** with no external dependencies at runtime.
All logic, styles, and assets must be inline or bundled.

### 2. Script placement
Place `<script>` tags at the **bottom of `<body>`**, or wrap DOM-dependent code in:
```javascript
window.onload = function() {
  // your code here
};
```
This ensures the DOM is ready before your script runs.

### 3. File input / upload
`<input type="file">` is fully supported. The platform natively handles the
file picker dialog on macOS and Windows.

### 4. Image / file download
Use the standard anchor download pattern:
```javascript
const link = document.createElement('a');
link.download = 'output.jpg';
link.href = canvas.toDataURL('image/jpeg', 0.9);
link.click();
```
The platform intercepts this and opens a native Save dialog on macOS.
On Windows, the file is saved directly via Edge App Mode.

### 5. No server-side logic
The tool runs entirely client-side. Do not generate code that:
- Makes API calls to a backend
- Requires a database
- Expects a server to be running

### 6. No hardcoded external URLs
Do not hardcode URLs that load resources at runtime (images, fonts, data files).
All assets must be embedded as Base64 `data:` URIs or bundled via `<script src>`.

---

## Reference: Minimal Valid Tool Structure

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>My Tool</title>
  <style>
    /* your styles here */
  </style>
</head>
<body>

  <!-- your UI here -->
  <button onclick="doSomething()">Click me</button>

  <script>
    function doSomething() {
      // your logic here
    }

    window.onload = function() {
      // DOM-dependent initialization here
    };
  </script>

</body>
</html>
```

---

## Summary Table

| Feature | Supported |
|---------|-----------|
| Inline `<style>` | ✅ |
| Inline `<script>` | ✅ |
| `<input type="file">` | ✅ |
| `<canvas>` | ✅ |
| onclick / event attributes | ✅ |
| addEventListener | ✅ |
| External CDN libraries (`<script src>`) | ✅ bundled at build time |
| `fetch` / XHR to external URLs | ❌ blocked by CSP |
| `<iframe>` | ❌ removed |
| `<object>` / `<embed>` | ❌ removed |
| External images at runtime | ❌ blocked by CSP |
| Server-side logic | ❌ not supported |