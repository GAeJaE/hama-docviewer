package com.hama.docviewer

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.OpenableColumns
import android.view.View
import android.view.ViewGroup.LayoutParams.MATCH_PARENT
import android.view.WindowInsets
import android.view.WindowInsetsController
import android.widget.LinearLayout
import android.webkit.JavascriptInterface
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import android.window.OnBackInvokedDispatcher
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

/**
 * 문서 뷰어 메인 화면.
 *
 * - 파일 관리자 등에서 파일을 탭하면 ACTION_VIEW 인텐트로 실행된다.
 * - 실제 렌더링은 assets/web 의 HTML/JS(오프라인 번들)가 담당한다.
 * - 열린 문서는 https://appassets.androidplatform.net/doc/<토큰> 경로로 WebView에 스트리밍된다.
 *   (파일 내용이 기기 밖으로 나가지 않음)
 */
class MainActivity : Activity() {

    private lateinit var webView: WebView

    private var currentUri: Uri? = null
    private var currentName: String = ""
    private var currentMime: String = ""
    private var docToken: Long = 0
    private var pageReady = false
    private var openedFromOutside = false

    private val updater by lazy {
        Updater(this) { fn, data ->
            runOnUiThread { webView.evaluateJavascript("window.$fn && window.$fn($data)", null) }
        }
    }

    private val assetLoader by lazy {
        WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .addPathHandler("/doc/", DocPathHandler())
            .build()
    }

    private inner class DocPathHandler : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse? {
            val uri = currentUri ?: return null
            return try {
                val input = contentResolver.openInputStream(uri) ?: return null
                WebResourceResponse("application/octet-stream", null, input).apply {
                    responseHeaders = mapOf("Cache-Control" to "no-store")
                }
            } catch (e: Exception) {
                WebResourceResponse("text/plain", "utf-8", 500, "Error",
                    mapOf("Cache-Control" to "no-store"), "파일을 읽을 수 없습니다: ${e.message}".byteInputStream())
            }
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        webView = WebView(this)
        setContentView(buildLayout())

        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            allowFileAccess = false
            allowContentAccess = false
            builtInZoomControls = true
            displayZoomControls = false
            setSupportZoom(true)
            useWideViewPort = true
            loadWithOverviewMode = false
            textZoom = 100
        }
        webView.addJavascriptInterface(Bridge(), "Android")
        webView.webChromeClient = WebChromeClient()
        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // 문서 안의 외부 링크는 브라우저로
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, url))
                } catch (_: ActivityNotFoundException) {
                }
                return true
            }
        }

        if (Build.VERSION.SDK_INT >= 33) {
            onBackInvokedDispatcher.registerOnBackInvokedCallback(
                OnBackInvokedDispatcher.PRIORITY_DEFAULT
            ) { handleBack() }
        }

        handleIntent(intent)
        webView.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")
    }

    /**
     * 상태바(시계)·내비게이션바 영역을 비워 두는 레이아웃.
     * Android 15+ 는 앱이 시스템 바 뒤까지 그려지도록 강제(edge-to-edge)하므로,
     * 시스템 바 크기만큼 위/아래 여백 뷰를 두고 앱 색으로 칠한다.
     */
    @Suppress("DEPRECATION")
    private fun buildLayout(): View {
        val topBar = View(this).apply { setBackgroundColor(COLOR_PRIMARY) }
        val bottomBar = View(this).apply { setBackgroundColor(COLOR_BOTTOM) }
        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(COLOR_PRIMARY)
            addView(topBar, LinearLayout.LayoutParams(MATCH_PARENT, 0))
            addView(webView, LinearLayout.LayoutParams(MATCH_PARENT, 0, 1f))
            addView(bottomBar, LinearLayout.LayoutParams(MATCH_PARENT, 0))
        }

        if (Build.VERSION.SDK_INT >= 30) {
            // 모든 버전에서 동일하게 edge-to-edge 로 그리고, 여백은 직접 계산
            window.setDecorFitsSystemWindows(false)
            window.statusBarColor = Color.TRANSPARENT
            window.navigationBarColor = Color.TRANSPARENT
            if (Build.VERSION.SDK_INT >= 29) window.isNavigationBarContrastEnforced = false
            window.insetsController?.setSystemBarsAppearance(
                WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS, // 아래쪽: 밝은 배경 + 어두운 아이콘
                WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS or
                    WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS // 위쪽: 파란 배경 + 흰 아이콘
            )
            root.setOnApplyWindowInsetsListener { v, insets ->
                val bars = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.displayCutout())
                topBar.layoutParams = topBar.layoutParams.apply { height = bars.top }
                bottomBar.layoutParams = bottomBar.layoutParams.apply { height = bars.bottom }
                v.setPadding(bars.left, 0, bars.right, 0)
                topBar.requestLayout()
                WindowInsets.CONSUMED
            }
        } else {
            // Android 10 이하: 시스템이 바 영역을 비워 주므로 색만 지정
            window.statusBarColor = COLOR_PRIMARY
            window.navigationBarColor = Color.BLACK
        }
        return root
    }

    override fun onResume() {
        super.onResume()
        updater.onResume() // '설치 허용' 설정에서 돌아온 경우 설치 이어가기
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        if (handleIntent(intent)) pushCurrentToPage()
    }

    /** 인텐트에서 문서 URI를 꺼낸다. 문서가 있으면 true. */
    private fun handleIntent(intent: Intent?): Boolean {
        if (intent == null) return false
        val uri: Uri? = when (intent.action) {
            Intent.ACTION_VIEW -> intent.data
            Intent.ACTION_SEND -> {
                @Suppress("DEPRECATION")
                if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                else intent.getParcelableExtra(Intent.EXTRA_STREAM)
            }
            else -> null
        }
        if (uri == null) return false
        setDocument(uri, intent.type)
        openedFromOutside = true
        return true
    }

    private fun setDocument(uri: Uri, typeHint: String?) {
        currentUri = uri
        currentName = queryDisplayName(uri) ?: uri.lastPathSegment?.substringAfterLast('/') ?: "문서"
        currentMime = contentResolver.getType(uri) ?: typeHint ?: ""
        docToken = System.currentTimeMillis()
    }

    private fun queryDisplayName(uri: Uri): String? {
        if (uri.scheme == "file") return uri.lastPathSegment
        return try {
            contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c ->
                if (c.moveToFirst()) c.getString(0) else null
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun currentDocJson(): String {
        if (currentUri == null) return ""
        return JSONObject()
            .put("name", currentName)
            .put("mime", currentMime)
            .put("url", "/doc/$docToken")
            .put("uri", currentUri.toString())
            .toString()
    }

    private fun pushCurrentToPage() {
        if (!pageReady) return // 페이지가 로드되면 JS가 getPending()으로 가져감
        val json = currentDocJson()
        if (json.isEmpty()) return
        webView.evaluateJavascript("window.openDocument && window.openDocument($json)", null)
    }

    private fun handleBack() {
        webView.evaluateJavascript("(window.onBack && window.onBack()) ? 'y' : 'n'") { result ->
            if (result?.contains("y") != true) finish()
        }
    }

    @Deprecated("Android 13 미만용")
    override fun onBackPressed() {
        handleBack()
    }

    // ---------------- 파일 선택 ----------------

    private fun openPicker() {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
        }
        @Suppress("DEPRECATION")
        startActivityForResult(intent, REQ_PICK)
    }

    @Deprecated("단순 Activity 사용")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQ_PICK || resultCode != RESULT_OK) return
        val uri = data?.data ?: return
        try {
            // 최근 문서에서 다시 열 수 있도록 영구 권한 요청
            contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
        } catch (_: Exception) {
        }
        setDocument(uri, null)
        openedFromOutside = false
        pushCurrentToPage()
    }

    // ---------------- JS 브리지 ----------------

    inner class Bridge {
        @JavascriptInterface
        fun getPending(): String {
            pageReady = true
            return currentDocJson()
        }

        @JavascriptInterface
        fun openedFromOutside(): Boolean = openedFromOutside

        @JavascriptInterface
        fun pickFile() = runOnUiThread { openPicker() }

        @JavascriptInterface
        fun openRecent(uriString: String, name: String) = runOnUiThread {
            val uri = Uri.parse(uriString)
            val readable = try {
                contentResolver.openInputStream(uri)?.close(); true
            } catch (_: Exception) {
                false
            }
            if (!readable) {
                webView.evaluateJavascript("window.recentFailed && window.recentFailed(${JSONObject.quote(uriString)})", null)
                return@runOnUiThread
            }
            setDocument(uri, null)
            if (currentName.isBlank()) currentName = name
            openedFromOutside = false
            pushCurrentToPage()
        }

        @JavascriptInterface
        fun share() = runOnUiThread {
            val uri = currentUri ?: return@runOnUiThread
            val send = Intent(Intent.ACTION_SEND).apply {
                type = currentMime.ifBlank { "application/octet-stream" }
                putExtra(Intent.EXTRA_STREAM, uri)
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            startActivity(Intent.createChooser(send, "공유"))
        }

        @JavascriptInterface
        fun openWithOther() = runOnUiThread {
            val uri = currentUri ?: return@runOnUiThread
            val view = Intent(Intent.ACTION_VIEW).apply {
                setDataAndType(uri, currentMime.ifBlank { "*/*" })
                addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
            }
            try {
                startActivity(Intent.createChooser(view, "다른 앱으로 열기"))
            } catch (_: ActivityNotFoundException) {
                Toast.makeText(this@MainActivity, "열 수 있는 앱이 없습니다", Toast.LENGTH_SHORT).show()
            }
        }

        @JavascriptInterface
        fun toast(msg: String) = runOnUiThread {
            Toast.makeText(this@MainActivity, msg, Toast.LENGTH_SHORT).show()
        }

        @JavascriptInterface
        fun close() = runOnUiThread { finish() }

        @JavascriptInterface
        fun appVersion(): String = updater.currentVersion

        @JavascriptInterface
        fun checkUpdate(manual: Boolean) = updater.check(manual)

        @JavascriptInterface
        fun downloadUpdate() = updater.downloadAndInstall()

        @JavascriptInterface
        fun openReleasePage() = runOnUiThread { updater.openReleasePage() }
    }

    companion object {
        private const val REQ_PICK = 1001
        private val COLOR_PRIMARY = Color.parseColor("#1F4E79")
        private val COLOR_BOTTOM = Color.parseColor("#F3F3F3")
    }
}
