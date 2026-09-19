package app.diarog.companion

import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class MainActivityTest {
    @Test fun firstLaunchStartsWithoutEnablingCollection() {
        Robolectric.buildActivity(MainActivity::class.java).use { controller ->
            val activity = controller.setup().get()
            val settings = Settings(activity)
            assertFalse(settings.enabled); assertFalse(settings.audio); assertFalse(settings.steps)
            assertFalse(LocationService.active)
            assertNotNull(activity.findViewById<android.view.View>(android.R.id.content))
        }
    }
}
