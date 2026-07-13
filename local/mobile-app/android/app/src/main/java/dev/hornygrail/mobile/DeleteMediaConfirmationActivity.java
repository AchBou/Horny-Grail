package dev.hornygrail.mobile;

import android.app.Activity;
import android.content.IntentSender;
import android.os.Bundle;
import android.os.Build;
import androidx.activity.ComponentActivity;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.activity.result.IntentSenderRequest;

/** Hosts Android's media-delete confirmation so the Capacitor plugin receives a normal activity result. */
public class DeleteMediaConfirmationActivity extends ComponentActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        IntentSender intentSender = readIntentSender();
        if (intentSender == null) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        var confirmationLauncher = registerForActivityResult(
            new ActivityResultContracts.StartIntentSenderForResult(),
            result -> {
                setResult(result.getResultCode());
                finish();
            }
        );

        confirmationLauncher.launch(new IntentSenderRequest.Builder(intentSender).build());
    }

    @SuppressWarnings("deprecation")
    private IntentSender readIntentSender() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            return getIntent().getParcelableExtra("intentSender", IntentSender.class);
        }
        return getIntent().getParcelableExtra("intentSender");
    }
}
