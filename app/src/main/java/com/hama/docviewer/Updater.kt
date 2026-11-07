package com.hama.docviewer

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * GitHub 릴리스(최신)를 확인해 새 버전이 있으면 APK 를 받아 설치 화면을 띄운다.
 * 외부 통신은 이 클래스뿐이며, 문서 내용은 전송하지 않는다.
 */
class Updater(private val activity: Activity, private val emit: (String, JSONObject) -> Unit) {

    data class Release(val version: String, val notes: String, val apkUrl: String, val size: Long, val page: String)

    @Volatile private var latest: Release? = null
    @Volatile private var downloading = false
    private var pendingInstall: File? = null

    val currentVersion: String by lazy {
        try {
            @Suppress("DEPRECATION")
            activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "0"
        } catch (_: Exception) {
            "0"
        }
    }

    /** 최신 릴리스 조회 → JS 로 결과 전달 (onUpdateInfo) */
    fun check(manual: Boolean) {
        Thread {
            val result = JSONObject().put("manual", manual).put("current", currentVersion)
            try {
                val rel = fetchLatest()
                latest = rel
                result.put("latest", rel.version)
                    .put("newer", compare(rel.version, currentVersion) > 0)
                    .put("notes", rel.notes)
                    .put("size", rel.size)
                    .put("page", rel.page)
            } catch (e: Exception) {
                result.put("error", e.message ?: e.javaClass.simpleName)
            }
            emit("onUpdateInfo", result)
        }.start()
    }

    private fun fetchLatest(): Release {
        val conn = (URL(API_LATEST).openConnection() as HttpURLConnection).apply {
            connectTimeout = 10_000
            readTimeout = 15_000
            setRequestProperty("Accept", "application/vnd.github+json")
            setRequestProperty("User-Agent", "HamaDocViewer/$currentVersion")
        }
        try {
            if (conn.responseCode != 200) throw RuntimeException("서버 응답 ${conn.responseCode}")
            val json = JSONObject(conn.inputStream.bufferedReader().use { it.readText() })
            val tag = json.getString("tag_name").trimStart('v', 'V')
            val assets = json.optJSONArray("assets")
            var url = ""
            var size = 0L
            if (assets != null) {
                for (i in 0 until assets.length()) {
                    val a = assets.getJSONObject(i)
                    if (a.optString("name").endsWith(".apk", ignoreCase = true)) {
                        url = a.getString("browser_download_url")
                        size = a.optLong("size")
                        break
                    }
                }
            }
            if (url.isEmpty()) throw RuntimeException("릴리스에 APK 파일이 없습니다")
            return Release(tag, json.optString("body"), url, size, json.optString("html_url", RELEASES_PAGE))
        } finally {
            conn.disconnect()
        }
    }

    /** APK 내려받기 → 설치 화면. 진행률은 onUpdateProgress 로 전달 */
    fun downloadAndInstall() {
        val rel = latest ?: return check(true)
        if (downloading) return
        downloading = true
        Thread {
            try {
                val dir = File(activity.cacheDir, "updates").apply { mkdirs() }
                dir.listFiles()?.forEach { it.delete() } // 이전에 받은 파일 정리
                val out = File(dir, "HamaDocViewer-${rel.version}.apk")
                download(rel, out)
                activity.runOnUiThread { install(out) }
            } catch (e: Exception) {
                emit("onUpdateProgress", JSONObject().put("error", e.message ?: "다운로드 실패"))
            } finally {
                downloading = false
            }
        }.start()
    }

    private fun download(rel: Release, out: File) {
        var url = URL(rel.apkUrl)
        var conn: HttpURLConnection
        // GitHub 은 다른 호스트로 리다이렉트하므로 직접 따라감
        var hops = 0
        while (true) {
            conn = (url.openConnection() as HttpURLConnection).apply {
                connectTimeout = 15_000
                readTimeout = 30_000
                instanceFollowRedirects = false
                setRequestProperty("User-Agent", "HamaDocViewer/$currentVersion")
            }
            val code = conn.responseCode
            if (code in 300..399 && hops++ < 5) {
                url = URL(url, conn.getHeaderField("Location"))
                conn.disconnect()
                continue
            }
            if (code != 200) throw RuntimeException("다운로드 실패 (응답 $code)")
            break
        }
        val total = conn.contentLengthLong.takeIf { it > 0 } ?: rel.size
        var done = 0L
        var lastPct = -1
        conn.inputStream.use { input ->
            out.outputStream().use { output ->
                val buf = ByteArray(64 * 1024)
                while (true) {
                    val n = input.read(buf)
                    if (n < 0) break
                    output.write(buf, 0, n)
                    done += n
                    val pct = if (total > 0) (done * 100 / total).toInt() else -1
                    if (pct != lastPct) {
                        lastPct = pct
                        emit("onUpdateProgress", JSONObject().put("percent", pct).put("done", done).put("total", total))
                    }
                }
            }
        }
        conn.disconnect()
        if (total > 0 && done != total) throw RuntimeException("다운로드가 중간에 끊겼습니다")
    }

    private fun install(apk: File) {
        // Android 8+ : '이 앱에서 설치 허용' 이 꺼져 있으면 설정 화면으로 안내 후 돌아오면 이어서 설치
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            pendingInstall = apk
            emit("onUpdateProgress", JSONObject().put("needPermission", true))
            activity.startActivity(
                Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${activity.packageName}"))
            )
            return
        }
        pendingInstall = null
        val uri = FileProvider.getUriForFile(activity, "${activity.packageName}.files", apk)
        val intent = Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        emit("onUpdateProgress", JSONObject().put("installing", true))
        activity.startActivity(intent)
    }

    /** 설정 화면에서 돌아왔을 때 호출 */
    fun onResume() {
        val apk = pendingInstall ?: return
        if (Build.VERSION.SDK_INT >= 26 && !activity.packageManager.canRequestPackageInstalls()) {
            pendingInstall = null
            emit("onUpdateProgress", JSONObject().put("error", "설치 권한이 허용되지 않았습니다. 다시 시도하면 설정 화면이 열립니다."))
            return
        }
        install(apk)
    }

    fun openReleasePage() {
        val page = latest?.page ?: RELEASES_PAGE
        activity.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(page)))
    }

    companion object {
        const val REPO = "GAeJaE/hama-docviewer"
        const val API_LATEST = "https://api.github.com/repos/$REPO/releases/latest"
        const val RELEASES_PAGE = "https://github.com/$REPO/releases/latest"

        /** "1.10" > "1.9" 처럼 숫자 단위로 비교 */
        fun compare(a: String, b: String): Int {
            val pa = a.split('.', '-').map { it.toIntOrNull() ?: 0 }
            val pb = b.split('.', '-').map { it.toIntOrNull() ?: 0 }
            for (i in 0 until maxOf(pa.size, pb.size)) {
                val d = pa.getOrElse(i) { 0 } - pb.getOrElse(i) { 0 }
                if (d != 0) return d
            }
            return 0
        }
    }
}
