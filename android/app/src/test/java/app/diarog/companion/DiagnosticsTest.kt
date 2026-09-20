package app.diarog.companion

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import java.io.File

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class DiagnosticsTest {
    @Test fun savedCredentialsNeverMeanLiveConnectionAndVerificationExpires() {
        val context = RuntimeEnvironment.getApplication()
        val diagnostics = Diagnostics(context)
        diagnostics.clear()
        Settings(context).enabled = true
        assertFalse(diagnostics.fresh())
        diagnostics.verified()
        assertTrue(diagnostics.fresh())
        assertFalse(diagnostics.fresh(diagnostics.time("connection") + 90_001))
        diagnostics.disconnected("HTTP 401")
        assertFalse(diagnostics.fresh())
        diagnostics.record("model", "50%")
        diagnostics.record("upload", "완료")
        assertEquals("50%", diagnostics.message("model"))
    }
    @Test fun readyMarkerAloneDoesNotMakeCorruptedModelReady() {
        val context = RuntimeEnvironment.getApplication()
        val directory = SpeechModel.directory(context)
        directory.mkdirs()
        File(directory, "READY").writeText(SpeechModel.NAME)
        assertFalse(SpeechModel.ready(context))
        for(path in listOf("am/final.mdl", "conf/model.conf", "graph/Gr.fst", "graph/HCLr.fst")) {
            File(directory, path).apply { parentFile!!.mkdirs(); writeText("fixture") }
        }
        assertTrue(SpeechModel.ready(context))
        File(directory, "graph/Gr.fst").writeText("")
        assertFalse(SpeechModel.ready(context))
        directory.deleteRecursively()
    }
}
