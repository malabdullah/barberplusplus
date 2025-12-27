import { supabase } from '../lib/supabase';

const BUCKET_NAME = 'avatars';

export const storageService = {
  /**
   * Upload an image to Supabase Storage
   * @param {File} file - The file to upload
   * @param {string} folder - The folder path (e.g., 'barbers', 'branches')
   * @param {string} entityId - The entity ID for the filename
   * @returns {Promise<string>} The public URL of the uploaded image
   */
  uploadImage: async (file, folder, entityId) => {
    const fileExt = file.name.split('.').pop().toLowerCase();
    const fileName = `${entityId}-${Date.now()}.${fileExt}`;
    const filePath = `${folder}/${fileName}`;

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false,
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

    // Extract the file path from the URL
    // URL format: https://xxx.supabase.co/storage/v1/object/public/avatars/folder/filename
    const urlParts = imageUrl.split(`/storage/v1/object/public/${BUCKET_NAME}/`);
    if (urlParts.length < 2) return;

    const filePath = urlParts[1];

    const { error } = await supabase.storage
      .from(BUCKET_NAME)
      .remove([filePath]);

    if (error) {
      console.error('Error deleting image:', error);
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
        console.error('Failed to delete old image:', err);
      });
    }

    return newUrl;
  },

  /**
   * Check if a URL is a valid storage URL (not base64)
   * @param {string} url - The URL to check
   * @returns {boolean}
   */
  isStorageUrl: (url) => {
    return url && !url.startsWith('data:') && url.includes('/storage/');
  },
};
