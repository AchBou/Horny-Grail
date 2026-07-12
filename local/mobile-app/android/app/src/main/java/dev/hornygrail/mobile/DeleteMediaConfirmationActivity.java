package dev.hornygrail.mobile;

import android.app.Activity;
import android.content.Intent;
import android.content.IntentSender;
import android.os.Bundle;

/** Hosts Android's media-delete confirmation so the Capacitor plugin receives a normal activity result. */
public class DeleteMediaConfirmationActivity extends Activity {
    private static final int DELETE_CONFIRMATION_REQUEST = 1;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        IntentSender intentSender = getIntent().getParcelableExtra("intentSender");
        if (intentSender == null) {
            setResult(RESULT_CANCELED);
            finish();
            return;
        }

        try {
            startIntentSenderForResult(intentSender, DELETE_CONFIRMATION_REQUEST, null, 0, 0, 0);
        } catch (IntentSender.SendIntentException error) {
            setResult(RESULT_CANCELED);
            finish();
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == DELETE_CONFIRMATION_REQUEST) {
            setResult(resultCode);
            finish();
        }
    }
}
