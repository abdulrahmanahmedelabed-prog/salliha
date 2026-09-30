package com.salliha.app;

import android.content.ContentValues;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

// Adds what Android WebView lacks: printing (receipts/labels) and saving backup files to Downloads.
public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getBridge().getWebView().addJavascriptInterface(new AndroidBridge(), "AndroidBridge");
    }

    class AndroidBridge {
        @JavascriptInterface
        public void print() {
            runOnUiThread(() -> {
                WebView web = getBridge().getWebView();
                PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                pm.print("Salliha", web.createPrintDocumentAdapter("Salliha"), new PrintAttributes.Builder().build());
            });
        }

        @JavascriptInterface
        public String saveFile(String name, String content) {
            try {
                byte[] data = content.getBytes(StandardCharsets.UTF_8);
                if (Build.VERSION.SDK_INT >= 29) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.Downloads.DISPLAY_NAME, name);
                    v.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Salliha");
                    try (OutputStream out = getContentResolver().openOutputStream(
                            getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v))) {
                        out.write(data);
                    }
                    return "تم الحفظ في التنزيلات/Salliha/" + name;
                }
                File dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                File f = new File(dir, name);
                try (FileOutputStream out = new FileOutputStream(f)) { out.write(data); }
                return "تم الحفظ في " + f.getAbsolutePath();
            } catch (Exception e) {
                return "تعذّر الحفظ: " + e.getMessage();
            }
        }
    }
}
