function createElement(documentRef, tagName, className, text) {
  const element = documentRef.createElement(tagName);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = String(text);
  return element;
}

export function createDescriptionDialog(header, description, documentRef = document) {
  const dialog = createElement(documentRef, 'div', 'description-dialog');
  dialog.style.display = 'none';

  const content = createElement(documentRef, 'div', 'description-dialog-content');
  const close = createElement(documentRef, 'span', 'description-dialog-close', '×');
  close.tabIndex = 0;
  content.appendChild(close);
  content.appendChild(
    createElement(documentRef, 'div', 'description-dialog-header', header || 'Section')
  );
  content.appendChild(createElement(documentRef, 'div', 'description-dialog-text', description));
  dialog.appendChild(content);
  return dialog;
}

export function createSupportingImageDialog(header, imageUrl, imageAlt, documentRef = document) {
  const dialog = createElement(documentRef, 'div', 'supporting-image-dialog');
  dialog.style.display = 'none';

  const content = createElement(documentRef, 'div', 'supporting-image-dialog-content');
  const close = createElement(documentRef, 'span', 'supporting-image-dialog-close', '×');
  close.tabIndex = 0;
  content.appendChild(close);
  content.appendChild(
    createElement(documentRef, 'div', 'supporting-image-dialog-header', header || '')
  );

  const imageContainer = createElement(documentRef, 'div', 'supporting-image-dialog-image');
  const image = createElement(documentRef, 'img');
  image.src = imageUrl;
  image.alt = imageAlt || '';
  imageContainer.appendChild(image);
  content.appendChild(imageContainer);
  dialog.appendChild(content);
  return dialog;
}

export function createAlertDialogContent(title, message, documentRef = document) {
  const content = createElement(documentRef, 'div', 'alert-dialog-content');
  const close = createElement(documentRef, 'span', 'alert-dialog-close', '×');
  close.tabIndex = 0;
  content.appendChild(close);
  content.appendChild(createElement(documentRef, 'div', 'alert-dialog-header', title));
  content.appendChild(createElement(documentRef, 'div', 'alert-dialog-text', message));

  const footer = createElement(documentRef, 'div', 'alert-dialog-footer');
  const okButton = createElement(documentRef, 'button', 'alert-dialog-ok-btn', 'OK');
  okButton.tabIndex = 0;
  footer.appendChild(okButton);
  content.appendChild(footer);
  return content;
}
