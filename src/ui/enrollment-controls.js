export function createEnrollmentControls() {
  const enrollBtn = document.createElement('button');
  enrollBtn.id = 'enrollBtn';
  enrollBtn.textContent = 'Enroll Face';
  enrollBtn.style.position = 'absolute';
  enrollBtn.style.bottom = '20px';
  enrollBtn.style.left = '20px';
  enrollBtn.style.padding = '10px 14px';
  enrollBtn.style.borderRadius = '8px';
  enrollBtn.style.border = 'none';
  enrollBtn.style.background = 'rgba(255,255,255,0.95)';
  enrollBtn.style.color = '#305CDE';
  enrollBtn.style.fontWeight = '600';
  enrollBtn.style.cursor = 'pointer';
  document.body.appendChild(enrollBtn);

  const clearEnrollBtn = document.createElement('button');
  clearEnrollBtn.id = 'clearEnrollBtn';
  clearEnrollBtn.textContent = 'Clear Enrollment';
  clearEnrollBtn.style.position = 'absolute';
  clearEnrollBtn.style.bottom = '20px';
  clearEnrollBtn.style.left = '140px';
  clearEnrollBtn.style.padding = '10px 14px';
  clearEnrollBtn.style.borderRadius = '8px';
  clearEnrollBtn.style.border = 'none';
  clearEnrollBtn.style.background = 'rgba(255,255,255,0.95)';
  clearEnrollBtn.style.color = '#305CDE';
  clearEnrollBtn.style.fontWeight = '600';
  clearEnrollBtn.style.cursor = 'pointer';
  document.body.appendChild(clearEnrollBtn);

  return { enrollBtn, clearEnrollBtn };
}