package app.diarog.companion

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Pending(val id: Long, val kind: String, val body: String, val attempts: Int)

class QueueStore(context: Context, private val seal: (String) -> String = Vault::seal, private val open: (String) -> String = Vault::open) : SQLiteOpenHelper(context, "companion.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL("CREATE TABLE outbox(id INTEGER PRIMARY KEY AUTOINCREMENT, key TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL DEFAULT 0, error TEXT)")
        db.execSQL("CREATE TABLE recordings(key TEXT PRIMARY KEY, retry_at INTEGER NOT NULL, state TEXT NOT NULL)")
    }
    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit
    fun enqueue(key: String, kind: String, body: String) {
        check(count() < 10_000 || hasKey(key)) { "대기 기록이 10,000개입니다. 먼저 동기화해 주세요." }
        writableDatabase.insertWithOnConflict("outbox", null, ContentValues().apply {
            put("key", key); put("kind", kind); put("body", seal(body))
        }, SQLiteDatabase.CONFLICT_REPLACE).also { check(it != -1L) }
    }
    private fun hasKey(key: String) = readableDatabase.rawQuery("SELECT 1 FROM outbox WHERE key=?", arrayOf(key)).use { it.moveToFirst() }
    fun pending(): List<Pending> = readableDatabase.rawQuery(
        "SELECT id,kind,body,attempts FROM outbox WHERE next_at<=? ORDER BY id LIMIT 50", arrayOf(System.currentTimeMillis().toString())
    ).use { c -> buildList { while(c.moveToNext()) add(Pending(c.getLong(0), c.getString(1), open(c.getString(2)), c.getInt(3))) } }
    // Replacing an updated step snapshot changes its row ID, so an old acknowledgement cannot delete it.
    fun acknowledge(id: Long) { writableDatabase.delete("outbox", "id=?", arrayOf(id.toString())) }
    fun fail(item: Pending, code: Int) {
        val delay = if (code in 400..499 && code !in listOf(408, 429)) 86_400_000L else (30_000L shl item.attempts.coerceAtMost(10)).coerceAtMost(21_600_000L)
        writableDatabase.update("outbox", ContentValues().apply {
            put("attempts", item.attempts + 1); put("next_at", System.currentTimeMillis() + delay); put("error", "HTTP $code")
        }, "id=?", arrayOf(item.id.toString()))
    }
    fun retry() { writableDatabase.execSQL("UPDATE outbox SET next_at=0"); writableDatabase.execSQL("DELETE FROM recordings WHERE state='failed'") }
    fun count(): Int = readableDatabase.rawQuery("SELECT count(*) FROM outbox", null).use { it.moveToFirst(); it.getInt(0) }
    fun failedCount(): Int = readableDatabase.rawQuery("SELECT count(*) FROM recordings WHERE state='failed'", null).use { it.moveToFirst(); it.getInt(0) }
    fun shouldRead(key: String): Boolean = readableDatabase.rawQuery("SELECT retry_at FROM recordings WHERE key=?", arrayOf(key)).use {
        !it.moveToFirst() || it.getLong(0) <= System.currentTimeMillis()
    }
    fun markRecording(key: String, success: Boolean) {
        writableDatabase.insertWithOnConflict("recordings", null, ContentValues().apply {
            put("key", key); put("retry_at", if(success) Long.MAX_VALUE else System.currentTimeMillis() + 86_400_000L)
            put("state", if(success) "queued" else "failed")
        }, SQLiteDatabase.CONFLICT_REPLACE)
    }
    fun clear() { writableDatabase.execSQL("DELETE FROM outbox"); writableDatabase.execSQL("DELETE FROM recordings") }
    fun clearKind(kind: String) { writableDatabase.delete("outbox", "kind=?", arrayOf(kind)) }
}
