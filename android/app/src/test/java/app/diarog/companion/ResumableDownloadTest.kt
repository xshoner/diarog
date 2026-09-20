package app.diarog.companion

import okhttp3.*
import okhttp3.ResponseBody.Companion.toResponseBody
import okio.Buffer
import okio.BufferedSource
import okio.Source
import okio.Timeout
import okio.buffer
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.net.SocketTimeoutException

class ResumableDownloadTest {
    private fun response(request: Request, code: Int, bytes: String, range: String? = null): Response =
        Response.Builder().request(request).protocol(Protocol.HTTP_1_1).code(code).message("test")
            .body(bytes.toResponseBody()).apply { if(range != null) header("Content-Range", range) }.build()

    @Test fun timeoutKeepsBytesAndNextRequestResumesExactly() {
        val file = File.createTempFile("speech-test", ".zip")
        try {
            val broken = OkHttpClient.Builder().addInterceptor { chain ->
                var calls = 0
                val body = object : ResponseBody() {
                    override fun contentType(): MediaType? = null
                    override fun contentLength() = 6L
                    override fun source(): BufferedSource = object : Source {
                        override fun read(sink: Buffer, byteCount: Long): Long {
                            if(calls++ == 0) { sink.writeUtf8("abc"); return 3 }
                            throw SocketTimeoutException("fixture timeout")
                        }
                        override fun timeout() = Timeout.NONE
                        override fun close() = Unit
                    }.buffer()
                }
                response(chain.request(), 200, "").newBuilder().body(body).build()
            }.build()
            try { ResumableDownload(broken).fetch("https://fixture.invalid/model", file, 6) { _, _ -> true }; fail("expected timeout") }
            catch (_: SocketTimeoutException) { }
            assertEquals("abc", file.readText())
            val resumed = OkHttpClient.Builder().addInterceptor { chain ->
                assertEquals("bytes=3-", chain.request().header("Range"))
                response(chain.request(), 206, "def", "bytes 3-5/6")
            }.build()
            assertTrue(ResumableDownload(resumed).fetch("https://fixture.invalid/model", file, 6) { _, _ -> true })
            assertEquals("abcdef", file.readText())
        } finally { file.delete() }
    }

    @Test fun serverIgnoringRangeRestartsWithoutDuplicatingPartialBytes() {
        val file = File.createTempFile("speech-test", ".zip")
        try {
            file.writeText("abc")
            val client = OkHttpClient.Builder().addInterceptor { response(it.request(), 200, "abcdef") }.build()
            assertTrue(ResumableDownload(client).fetch("https://fixture.invalid/model", file, 6) { _, _ -> true })
            assertEquals("abcdef", file.readText())
        } finally { file.delete() }
    }

    @Test fun invalidRangeCannotBeAppendedAndCompleteArchiveNeedsNoNetwork() {
        val file = File.createTempFile("speech-test", ".zip")
        try {
            file.writeText("abc")
            val client = OkHttpClient.Builder().addInterceptor { response(it.request(), 206, "def", "bytes 0-2/6") }.build()
            try { ResumableDownload(client).fetch("https://fixture.invalid/model", file, 6) { _, _ -> true }; fail("expected invalid range") }
            catch (_: java.io.IOException) { }
            assertEquals(0, file.length())
            file.writeText("abcdef")
            val offline = OkHttpClient.Builder().addInterceptor { error("must not use network") }.build()
            assertTrue(ResumableDownload(offline).fetch("https://fixture.invalid/model", file, 6) { _, _ -> true })
        } finally { file.delete() }
    }

    @Test fun workerTimeBudgetPreservesProgressForNextRun() {
        val file = File.createTempFile("speech-test", ".zip")
        try {
            val client = OkHttpClient.Builder().addInterceptor { response(it.request(), 200, "abcdef") }.build()
            assertFalse(ResumableDownload(client).fetch("https://fixture.invalid/model", file, 6) { bytes, _ -> bytes == 0L })
            assertEquals("abcdef", file.readText())
        } finally { file.delete() }
    }
}
