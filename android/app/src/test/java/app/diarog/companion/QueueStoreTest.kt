package app.diarog.companion

import android.content.Context
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class QueueStoreTest {
    private lateinit var context: Context
    // This fixture tests queue durability; Android Keystore needs a device/instrumentation test.
    private fun queue() = QueueStore(context, { "sealed:$it" }, { it.removePrefix("sealed:") })
    @Before fun clear() { context = RuntimeEnvironment.getApplication(); context.deleteDatabase("companion.db") }

    @Test fun pendingDataSurvivesReopenAndOldAcknowledgementCannotDeleteNewerSnapshot() {
        val old = queue().use { it.enqueue("steps:day", "steps", "100"); it.pending().single() }
        queue().use {
            assertEquals("100", it.pending().single().body)
            it.enqueue("steps:day", "steps", "200")
            it.acknowledge(old.id)
            assertEquals(1, it.count()); assertEquals("200", it.pending().single().body)
            it.acknowledge(it.pending().single().id); assertEquals(0, it.count())
        }
    }
    @Test fun transientFailureStaysQueuedAndManualRetryMakesItEligible() {
        queue().use {
            it.enqueue("audio:hash", "audio", "transcript")
            it.fail(it.pending().single(), 503)
            assertEquals(1, it.count()); assertTrue(it.pending().isEmpty())
            it.retry(); assertEquals(1, it.pending().single().attempts)
        }
    }
    @Test fun disablingOneSourcePreservesTheOthersAndDisconnectClearsEverything() {
        queue().use {
            it.enqueue("audio:hash", "audio", "transcript"); it.enqueue("location:time", "location", "point")
            it.markRecording("file", true); assertFalse(it.shouldRead("file"))
            it.clearKind("audio"); assertEquals("location", it.pending().single().kind)
            it.clear(); assertEquals(0, it.count()); assertTrue(it.shouldRead("file"))
        }
    }
    @Test fun recordFailuresDoNotBlockOtherFilesAndCanBeRetried() {
        queue().use {
            it.markRecording("broken", false); assertFalse(it.shouldRead("broken")); assertTrue(it.shouldRead("new"))
            assertEquals(1, it.failedCount()); it.retry(); assertTrue(it.shouldRead("broken"))
        }
    }
}
