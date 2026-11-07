const ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const VALID_EXTENSIONS = { 'image/jpeg': ['jpg','jpeg'], 'image/png': ['png'], 'image/webp': ['webp'], 'image/gif': ['gif'] };
export const validateImageFile = file => {
  if (!file) throw new Error('No file provided');
    // Check MIME type
    if (!ALLOWED_MIME_TYPES.includes(file.type)) {
      throw new Error(`Invalid file type. Allowed types: JPEG, PNG, WebP, GIF`);
    }

    // Check file size
    if (file.size > MAX_FILE_SIZE) {
      throw new Error(`File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Check that extension matches MIME type
    const ext = file.name.split('.').pop()?.toLowerCase();
    const validExts = VALID_EXTENSIONS[file.type];
    if (!validExts || !validExts.includes(ext)) {
      throw new Error('File extension does not match file type');
    }

  return true;
};
