package com.baealex.oceanwave.storage

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

class OceanWaveStorageModule(reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  private val preferences = reactContext.getSharedPreferences("ocean_wave_storage", Context.MODE_PRIVATE)

  override fun getName(): String = "OceanWaveStorage"

  @ReactMethod
  fun getString(key: String, promise: Promise) {
    promise.resolve(preferences.getString(key, null))
  }

  @ReactMethod
  fun setString(key: String, value: String, promise: Promise) {
    preferences.edit().putString(key, value).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun removeString(key: String, promise: Promise) {
    preferences.edit().remove(key).apply()
    promise.resolve(true)
  }

  @ReactMethod
  fun cacheRemoteImage(url: String, cookie: String?, promise: Promise) {
    try {
      val cacheDirectory = File(reactApplicationContext.cacheDir, "ocean_wave_artwork")
      if (!cacheDirectory.exists()) {
        cacheDirectory.mkdirs()
      }

      val file = File(cacheDirectory, "${sha256(url)}.jpg")
      if (file.exists() && file.length() > 0) {
        promise.resolve(file.toURI().toString())
        return
      }

      val connection = URL(url).openConnection() as HttpURLConnection
      connection.requestMethod = "GET"
      connection.connectTimeout = 10_000
      connection.readTimeout = 10_000
      if (!cookie.isNullOrBlank()) {
        connection.setRequestProperty("Cookie", cookie)
      }

      connection.inputStream.use { input ->
        file.outputStream().use { output ->
          input.copyTo(output)
        }
      }

      if (connection.responseCode !in 200..299) {
        file.delete()
        promise.reject("IMAGE_CACHE_HTTP_${connection.responseCode}", "Image request failed (${connection.responseCode})")
        return
      }

      promise.resolve(file.toURI().toString())
    } catch (error: Exception) {
      promise.reject("IMAGE_CACHE_FAILED", error)
    }
  }

  private fun sha256(value: String): String {
    val digest = MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) }
  }
}
