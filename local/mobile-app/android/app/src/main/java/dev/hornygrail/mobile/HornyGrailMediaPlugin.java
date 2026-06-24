package dev.hornygrail.mobile;

import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;

@CapacitorPlugin(name = "HornyGrailMedia")
public class HornyGrailMediaPlugin extends Plugin {
    private static final int DEFAULT_MAX_DIMENSION = 320;
    private static final int DEFAULT_JPEG_QUALITY = 90;
    private static final int BACKGROUND_COLOR = Color.rgb(17, 24, 39);

    @PluginMethod
    public void createVideoThumbnail(PluginCall call) {
        File tempFile = null;
        MediaMetadataRetriever retriever = new MediaMetadataRetriever();
        Bitmap frame = null;
        Bitmap thumbnail = null;

        try {
            int maxDimension = Math.max(1, call.getInt("maxDimension", DEFAULT_MAX_DIMENSION));
            int quality = Math.min(100, Math.max(1, call.getInt("quality", DEFAULT_JPEG_QUALITY)));

            String sourcePath = call.getString("sourcePath");
            String sourceDataUrl = call.getString("sourceDataUrl");
            String mimeType = call.getString("mimeType", "video/webm");

            if (sourcePath != null && !sourcePath.isEmpty()) {
                setRetrieverDataSource(retriever, sourcePath);
            } else if (sourceDataUrl != null && !sourceDataUrl.isEmpty()) {
                tempFile = writeDataUrlToTempFile(sourceDataUrl, mimeType);
                retriever.setDataSource(tempFile.getAbsolutePath());
            } else {
                call.reject("Expected sourcePath or sourceDataUrl");
                return;
            }

            long targetTimeUs = getRepresentativeFrameTimeUs(retriever);
            frame = retriever.getFrameAtTime(targetTimeUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC);
            if (frame == null) {
                frame = retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST);
            }

            if (frame == null) {
                call.reject("Unable to decode a video frame");
                return;
            }

            thumbnail = drawContainedThumbnail(frame, maxDimension);
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            if (!thumbnail.compress(Bitmap.CompressFormat.JPEG, quality, output)) {
                call.reject("Unable to encode JPEG thumbnail");
                return;
            }

            JSObject result = new JSObject();
            result.put("thumbnailBase64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            call.resolve(result);
        } catch (Exception error) {
            call.reject("Native video thumbnail generation failed", error);
        } finally {
            try {
                retriever.release();
            } catch (Exception ignored) {
                // Nothing useful to recover here.
            }

            if (frame != null && !frame.isRecycled()) {
                frame.recycle();
            }

            if (thumbnail != null && thumbnail != frame && !thumbnail.isRecycled()) {
                thumbnail.recycle();
            }

            if (tempFile != null && tempFile.exists()) {
                tempFile.delete();
            }
        }
    }

    private void setRetrieverDataSource(MediaMetadataRetriever retriever, String sourcePath) {
        if (sourcePath.startsWith("content://") || sourcePath.startsWith("file://")) {
            retriever.setDataSource(getContext(), Uri.parse(sourcePath));
            return;
        }

        retriever.setDataSource(sourcePath);
    }

    private File writeDataUrlToTempFile(String sourceDataUrl, String mimeType) throws IOException {
        int separatorIndex = sourceDataUrl.indexOf(',');
        if (separatorIndex < 0 || !sourceDataUrl.substring(0, separatorIndex).contains(";base64")) {
            throw new IOException("Expected base64 data URL");
        }

        String base64Payload = sourceDataUrl.substring(separatorIndex + 1);
        byte[] bytes = Base64.decode(base64Payload, Base64.DEFAULT);
        String suffix = "video/webm".equals(mimeType) ? ".webm" : ".video";
        File tempFile = File.createTempFile("hornygrail-video-", suffix, getContext().getCacheDir());

        try (FileOutputStream output = new FileOutputStream(tempFile)) {
            output.write(bytes);
        }

        return tempFile;
    }

    private long getRepresentativeFrameTimeUs(MediaMetadataRetriever retriever) {
        String durationValue = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION);
        if (durationValue == null) {
            return 0;
        }

        try {
            long durationMs = Long.parseLong(durationValue);
            long durationUs = durationMs * 1000;
            long quarterUs = durationUs / 4;
            long latestSafeUs = Math.max(durationUs - 100000, 0);
            return Math.min(Math.max(quarterUs, 0), latestSafeUs);
        } catch (NumberFormatException ignored) {
            return 0;
        }
    }

    private Bitmap drawContainedThumbnail(Bitmap frame, int size) {
        Bitmap output = Bitmap.createBitmap(size, size, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(output);
        canvas.drawColor(BACKGROUND_COLOR);

        int sourceWidth = frame.getWidth();
        int sourceHeight = frame.getHeight();
        float scale = Math.min((float) size / sourceWidth, (float) size / sourceHeight);
        int width = Math.max(1, Math.round(sourceWidth * scale));
        int height = Math.max(1, Math.round(sourceHeight * scale));
        int left = (size - width) / 2;
        int top = (size - height) / 2;
        Rect destination = new Rect(left, top, left + width, top + height);

        Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG | Paint.FILTER_BITMAP_FLAG | Paint.DITHER_FLAG);
        canvas.drawBitmap(frame, null, destination, paint);
        return output;
    }
}
