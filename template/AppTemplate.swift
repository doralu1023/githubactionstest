import Cocoa
import WebKit
import Foundation

class AppDelegate: NSObject, NSApplicationDelegate, WKUIDelegate, WKNavigationDelegate, WKScriptMessageHandler {
    var window: NSWindow!
    var webView: WKWebView!
    func applicationDidFinishLaunching(_ notification: Notification) {
        // 1. 先建 configuration
        let config = WKWebViewConfiguration()
        
        // 2. 建 userContentController 並加入 handler
        let uc = WKUserContentController()
        uc.add(self, name: "nativeDownload")
        uc.add(self, name: "jslog")
        
        // 3. 注入 JS
        let downloadJS = WKUserScript(source: """
        (function() {
            console.log('[INJECT] interceptor loaded');
            const _orig = URL.createObjectURL.bind(URL);
            const _map = new Map();
            URL.createObjectURL = function(blob) {
                const url = _orig(blob);
                if (blob instanceof Blob) _map.set(url, blob);
                return url;
            };
            function sendToNative(blob, filename) {
                const reader = new FileReader();
                reader.onload = function() {
                    window.webkit.messageHandlers.nativeDownload.postMessage(
                        { data: reader.result, filename: filename || 'download' }
                    );
                };
                reader.readAsDataURL(blob);
            }
            const _origClick = HTMLAnchorElement.prototype.click;
            HTMLAnchorElement.prototype.click = function() {
                const href = this.getAttribute('href') || this.href || '';
                if ((href.startsWith('data:') || href.startsWith('blob:')) && this.download) {
                    fetch(href).then(r => r.blob()).then(b => sendToNative(b, this.download));
                    return;
                }
                _origClick.call(this);
            };
            document.addEventListener('click', function(e) {
                const a = e.target.closest ? e.target.closest('a[download]') : null;
                if (!a) return;
                const href = a.getAttribute('href') || '';
                if (href.startsWith('data:') || href.startsWith('blob:')) {
                    e.preventDefault();
                    fetch(href).then(r => r.blob()).then(b => sendToNative(b, a.download || 'download'));
                }
            }, true);
            console.log = function() {
                window.webkit.messageHandlers.jslog.postMessage(Array.from(arguments).join(' '));
            };
        })();
        """, injectionTime: .atDocumentStart, forMainFrameOnly: false)
        uc.addUserScript(downloadJS)
        
        // 4. 把 uc 接上 config
        config.userContentController = uc
        
        // 5. 用 config 建 webView
        webView = WKWebView(frame: .zero, configuration: config)
        webView.uiDelegate = self
        webView.navigationDelegate = self
        webView.autoresizingMask = [.width, .height]
        
        // 6. 建視窗
        window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 1024, height: 768),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.center()
        window.title = "TWEC AI Tool Sandbox"
        window.contentView?.addSubview(webView)
        webView.frame = window.contentView!.bounds
        window.makeKeyAndOrderFront(nil)
        
        // 7. 載入 HTML
        let encoded = "__HTML_CONTENT_PLACEHOLDER__"
        let decoded = Data(base64Encoded: encoded)!
        let htmlString = String(data: decoded, encoding: .utf8)!
        print("[SWIFT] 開始載入 HTML, navigationDelegate = \(String(describing: webView.navigationDelegate))")
        webView.loadHTMLString(htmlString, baseURL: nil)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        print("[SWIFT] 頁面載入完成，手動注入 JS")
        let js = """
            (function() {
                function sendToNative(dataURI, filename) {
                    window.webkit.messageHandlers.nativeDownload.postMessage(
                        { data: dataURI, filename: filename || 'download' }
                    );
                }
                const _origClick = HTMLAnchorElement.prototype.click;
                HTMLAnchorElement.prototype.click = function() {
                    const href = this.href || '';
                    const dl = this.download || '';
                    console.log('[CLICK] href prefix:', href.substring(0, 30), 'download:', dl);
                    if (dl && (href.startsWith('data:') || href.startsWith('blob:'))) {
                        if (href.startsWith('data:')) {
                            sendToNative(href, dl);
                        } else {
                            fetch(href).then(r => r.blob()).then(b => {
                                const reader = new FileReader();
                                reader.onload = () => sendToNative(reader.result, dl);
                                reader.readAsDataURL(b);
                            });
                        }
                        return;
                    }
                    _origClick.call(this);
                };
                console.log('[INJECT] v2 done');
            })();
            """
        webView.evaluateJavaScript(js) { result, error in
            if let error = error {
                print("[SWIFT] JS 注入失敗: \(error)")
            } else {
                print("[SWIFT] JS 注入成功")
            }
        }
    }

    func userContentController(_ uc: WKUserContentController,
                            didReceive message: WKScriptMessage) {
        if message.name == "jslog" {
            print("[JS]", message.body)
            return
        }
        print("[NATIVE] 收到訊息: \(message.name)")
        guard message.name == "nativeDownload",
            let body = message.body as? [String: Any],
            let dataURI = body["data"] as? String,
            let filename = body["filename"] as? String else { return }
        guard let comma = dataURI.firstIndex(of: ",") else { return }
        let b64 = String(dataURI[dataURI.index(after: comma)...])
        guard let data = Data(base64Encoded: b64) else { return }
        DispatchQueue.main.async {
            let panel = NSSavePanel()
            panel.nameFieldStringValue = filename
            panel.begin { result in
                if result == .OK, let url = panel.url {
                    try? data.write(to: url)
                }
            }
        }
    }

    func webView(_ webView: WKWebView,
             runOpenPanelWith parameters: WKOpenPanelParameters,
             initiatedByFrame frame: WKFrameInfo,
             completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseFiles = true
        panel.canChooseDirectories = false
        panel.begin { result in
            completionHandler(result == .OK ? panel.urls : nil)
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { true }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.run()