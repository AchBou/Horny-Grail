package dev.hornygrail.mobile;

import android.os.Bundle;
import android.view.WindowManager;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(HornyGrailMediaPlugin.class);
        super.onCreate(savedInstanceState);

        // Private vault: blank the app in the recent-apps switcher and block
        // screenshots and screen recording of its content.
        getWindow().setFlags(
            WindowManager.LayoutParams.FLAG_SECURE,
            WindowManager.LayoutParams.FLAG_SECURE
        );
    }
}
