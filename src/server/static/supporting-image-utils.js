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
