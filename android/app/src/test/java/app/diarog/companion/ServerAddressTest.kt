package app.diarog.companion

import org.junit.Assert.*
import org.junit.Test

class ServerAddressTest {
    @Test fun normalizeHttpsOrigin() { assertEquals("https://diarog.vercel.app", Settings.normalizeServer(" https://diarog.vercel.app/ ")) }
    @Test fun rejectInsecureOrAmbiguousEndpoints() {
        for(url in listOf("http://example.com", "https://user:password@example.com", "https://example.com/api", "https://example.com?x=1", "https://example.com#fragment", "file:///secret", "https:///")) {
            assertThrows(IllegalArgumentException::class.java) { Settings.normalizeServer(url) }
        }
    }
}
