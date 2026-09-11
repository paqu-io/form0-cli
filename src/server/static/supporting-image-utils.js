/**
 * Utility to resolve the supporting image path for a field
 * If supporting_image_path is provided, use it; otherwise, try data_name + .jpg/.jpeg/.png
 * @param {object} field - The field definition
 * @returns {string|undefined} - The resolved image path or undefined
 */
export function resolveSupportingImagePath(field) {
  if (!field) return undefined;
  if (typeof field.supporting_image_path === 'string' && field.supporting_image_path.length > 0) {
    return field.supporting_image_path;
  }
  if (field.supporting_image) {
    // Try .jpg, .jpeg, .png in that order (assume .jpg is preferred)
    const exts = ['jpg', 'jpeg', 'png'];
    for (const ext of exts) {
      // In a real implementation, you might check file existence, but here just prefer .jpg > .jpeg > .png
      return `${field.data_name}.${ext}`;
    }
  }
  return undefined;
}

/**
 * Resolve a supporting image to an HTTP(S) URL or a safe project-relative URL.
 * @param {object} field - The field definition
 * @returns {string|undefined} - A browser-safe image URL or undefined
 */
export function resolveSupportingImageUrl(field) {
  const imagePath = resolveSupportingImagePath(field);
  if (!imagePath || /[\u0000-\u001f\u007f]/.test(imagePath)) return undefined;

  try {
    const url = new URL(imagePath);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : undefined;
  } catch {
    // A local supporting-image path is expected to be relative, not a URL.
  }

  if (imagePath.startsWith('/') || imagePath.includes('\\')) return undefined;
  const segments = imagePath.split('/');
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return undefined;
  }

  return `/supporting-images/${segments.map(encodeURIComponent).join('/')}`;
}
