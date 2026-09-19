package app.diarog.companion

import android.app.Activity
import android.os.Bundle
import android.widget.ScrollView
import android.widget.TextView

class LicenseActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(ScrollView(this).apply { addView(TextView(this@LicenseActivity).apply {
            textSize = 13f; setPadding(28, 64, 28, 32)
            text = resources.openRawResource(R.raw.third_party_notices).bufferedReader().use { it.readText() }
        }) })
    }
}
