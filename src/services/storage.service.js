import { validateImageFile } from '../utils/imageValidation';
import { supabase } from '../lib/supabase';
import { logErrorDev } from '../utils/security';

const BUCKET_NAME = 'avatars';

export const storageService = {
  validateFile: validateImageFile,

  /**
   * Upload an image to Supabase Storage
   * @param {File} file - The file to upload
   * @param {string} folder - The folder path (e.g., 'barbers', 'branches')
   * @param {string} entityId - The entity ID for the filename
   * @returns {Promise<string>} The public URL of the uploaded image
   */
  uploadImage: async (file, folder, entityId) => {
    // Security: Validate file before upload
    storageService.validateFile(file);

    const fileExt = file.name.split('.').pop().toLowerCase();
    // Sanitize entityId to prevent path traversal
    const sanitizedEntityId = entityId.replace(/[^a-zA-Z0-9-]/g, '');
    const fileName = `${sanitizedEntityId}-${Date.now()}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: file.type, // Explicitly set content type
      });

    if (error) throw error;

    const { data } = supabase.storage
      .from(BUCKET_NAME)
      .getPublicUrl(filePath);

    return data.publicUrl;
  },

  /**
   * Delete an image from Supabase Storage by its URL
   * @param {string} imageUrl - The full public URL of the image
   * @returns {Promise<void>}
   */
  deleteImage: async (imageUrl) => {
    // Skip if no URL or if it's a base64 data URL (legacy)
    if (!imageUrl || imageUrl.startsWith('data:')) return;

    // Extract by pathname so URLs from either hosted or self-hosted Supabase
    // remain deletable throughout the rollback window.
    const storagePathPrefix = `/storage/v1/object/public/${BUCKET_NAME}/`;
    let filePath;

    try {
      const imagePathname = new URL(imageUrl).pathname;
      const prefixIndex = imagePathname.indexOf(storagePathPrefix);
      if (prefixIndex === -1) return;

      filePath = imagePathname
        .slice(prefixIndex + storagePathPrefix.length)
        .split('/')
        .map((segment) => decodeURIComponent(segment))
        .join('/');
    } catch {
      return;
    }

    if (!filePath) return;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      logErrorDev('Error deleting image:', error);
      // Don't throw - deletion failure shouldn't block other operations
    }
  },

  /**
   * Replace an existing image with a new one
   * Uploads new image first, then deletes old one
   * @param {File} file - The new file to upload
   * @param {string} folder - The folder path
   * @param {string} entityId - The entity ID for the filename
   * @param {string|null} oldImageUrl - The URL of the old image to delete
   * @returns {Promise<string>} The public URL of the new image
   */
  replaceImage: async (file, folder, entityId, oldImageUrl) => {
    // Upload new image first (ensures we don't delete old one if upload fails)
    const newUrl = await storageService.uploadImage(file, folder, entityId);

    // Delete old image in background (fire and forget)
    if (oldImageUrl && !oldImageUrl.startsWith('data:')) {
      storageService.deleteImage(oldImageUrl).catch((err) => {
        logErrorDev('Failed to delete old image:', err);
      });
    }

    return newUrl;
  },
};
