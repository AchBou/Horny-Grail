package dev.hornygrail.mobile;

import android.app.Activity;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Rect;
import android.media.MediaMetadataRetriever;
import android.net.Uri;
import android.os.Build;
import android.provider.MediaStore;
import android.provider.OpenableColumns;
import android.provider.DocumentsContract;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.UUID;

@CapacitorPlugin(name = "HornyGrailMedia")
public class HornyGrailMediaPlugin extends Plugin {
    private static final int DEFAULT_MAX_DIMENSION = 320;
    private static final int DEFAULT_JPEG_QUALITY = 90;
    private static final int BACKGROUND_COLOR = Color.rgb(17, 24, 39);

    @PluginMethod
    public void pickMedia(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT)
            .addCategory(Intent.CATEGORY_OPENABLE)
            .setType("*/*")
            .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            .putExtra(Intent.EXTRA_MIME_TYPES, new String[] {
                "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "image/tiff",
                "video/webm", "video/mp4"
            })
            .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "handleMediaPick");
    }

    @ActivityCallback
    private void handleMediaPick(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject emptyResponse = new JSObject();
            emptyResponse.put("items", new JSArray());
            call.resolve(emptyResponse);
            return;
        }

        try {
            Intent data = result.getData();
            ArrayList<Uri> uris = new ArrayList<>();
            ClipData clipData = data.getClipData();
            if (clipData != null) {
                for (int index = 0; index < clipData.getItemCount(); index += 1) {
                    uris.add(clipData.getItemAt(index).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }

            JSArray items = new JSArray();
            for (Uri uri : uris) {
                if (uri == null) {
                    continue;
                }
                items.put(copyPickedMedia(uri));
            }
            JSObject response = new JSObject();
            response.put("items", items);
            call.resolve(response);
        } catch (Exception error) {
            call.reject("Could not read selected media", error);
        }
    }

    @PluginMethod
    public void deletePickedMedia(PluginCall call) {
        ArrayList<Uri> uris = new ArrayList<>();
        JSArray sourceUris = call.getArray("sourceUris");
        if (sourceUris != null) {
            for (int index = 0; index < sourceUris.length(); index += 1) {
                String sourceUri = sourceUris.optString(index, null);
                if (sourceUri != null) {
                    uris.add(Uri.parse(sourceUri));
                }
            }
        } else {
            String sourceUri = call.getString("sourceUri");
            if (sourceUri != null) {
                uris.add(Uri.parse(sourceUri));
            }
        }

        if (uris.isEmpty()) {
            call.reject("No media files were selected for deletion");
            return;
        }
        for (Uri uri : uris) {
            if (!"content".equals(uri.getScheme()) || !MediaStore.AUTHORITY.equals(uri.getAuthority())) {
                call.reject("This file cannot be deleted through Android media storage");
                return;
            }
        }
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) {
            call.unavailable("Deleting uploaded media requires Android 11 or later");
            return;
        }

        Intent confirmation = new Intent(getContext(), DeleteMediaConfirmationActivity.class);
        confirmation.putExtra("intentSender", MediaStore.createDeleteRequest(
            getContext().getContentResolver(),
            uris
        ).getIntentSender());
        startActivityForResult(call, confirmation, "handleMediaDelete");
    }

    @ActivityCallback
    private void handleMediaDelete(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        JSObject response = new JSObject();
        response.put("deleted", result.getResultCode() == Activity.RESULT_OK);
        response.put("cancelled", result.getResultCode() != Activity.RESULT_OK);
        call.resolve(response);
    }

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

    private JSObject copyPickedMedia(Uri uri) throws IOException {
        ContentResolver resolver = getContext().getContentResolver();
        try {
            resolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } catch (SecurityException ignored) {
            // Providers that do not support persisted grants are still readable for this selection.
        }

        String displayName = getDisplayName(resolver, uri);
        File cacheFile = new File(getContext().getCacheDir(), "picked-" + UUID.randomUUID() + "-" + displayName);
        try (InputStream input = resolver.openInputStream(uri); FileOutputStream output = new FileOutputStream(cacheFile)) {
            if (input == null) {
                throw new IOException("Could not open selected media");
            }

            byte[] buffer = new byte[64 * 1024];
            int count;
            while ((count = input.read(buffer)) != -1) {
                output.write(buffer, 0, count);
            }
        }

        JSObject item = new JSObject();
        item.put("name", displayName);
        item.put("mimeType", resolver.getType(uri));
        item.put("size", cacheFile.length());
        item.put("cachePath", cacheFile.getAbsolutePath());
        item.put("sourcePath", cacheFile.getAbsolutePath());
        Uri deletableUri = toMediaStoreUri(uri);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && deletableUri != null) {
            item.put("sourceUri", deletableUri.toString());
        }
        return item;
    }

    private Uri toMediaStoreUri(Uri uri) {
        if (uri == null || !"content".equals(uri.getScheme())) {
            return null;
        }

        if (MediaStore.AUTHORITY.equals(uri.getAuthority())) {
            return uri;
        }

        if (!"com.android.providers.media.documents".equals(uri.getAuthority())
            || !DocumentsContract.isDocumentUri(getContext(), uri)) {
            return null;
        }

        String documentId = DocumentsContract.getDocumentId(uri);
        int separator = documentId.indexOf(':');
        if (separator <= 0 || separator == documentId.length() - 1) {
            return null;
        }

        String mediaType = documentId.substring(0, separator);
        String mediaId = documentId.substring(separator + 1);
        if ("image".equals(mediaType)) {
            return MediaStore.Images.Media.EXTERNAL_CONTENT_URI.buildUpon().appendPath(mediaId).build();
        }
        if ("video".equals(mediaType)) {
            return MediaStore.Video.Media.EXTERNAL_CONTENT_URI.buildUpon().appendPath(mediaId).build();
        }
        return null;
    }

    private String getDisplayName(ContentResolver resolver, Uri uri) {
        try (android.database.Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int columnIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (columnIndex >= 0) {
                    String displayName = cursor.getString(columnIndex);
                    if (displayName != null && !displayName.isEmpty()) {
                        return displayName.replaceAll("[^a-zA-Z0-9._-]", "_");
                    }
                }
            }
        }
        return "media";
    }

    private File writeDataUrlToTempFile(String sourceDataUrl, String mimeType) throws IOException {
        int separatorIndex = sourceDataUrl.indexOf(',');
        if (separatorIndex < 0 || !sourceDataUrl.substring(0, separatorIndex).contains(";base64")) {
            throw new IOException("Expected base64 data URL");
        }

        String base64Payload = sourceDataUrl.substring(separatorIndex + 1);
        byte[] bytes = Base64.decode(base64Payload, Base64.DEFAULT);
        String suffix;
        if ("video/webm".equals(mimeType)) {
            suffix = ".webm";
        } else if ("video/mp4".equals(mimeType)) {
            suffix = ".mp4";
        } else {
            suffix = ".video";
        }
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
