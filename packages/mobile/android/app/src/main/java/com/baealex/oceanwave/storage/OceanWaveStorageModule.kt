package com.baealex.oceanwave.storage

import android.content.Context
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

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
}
