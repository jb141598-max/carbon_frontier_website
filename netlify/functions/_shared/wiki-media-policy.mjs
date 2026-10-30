// Read-only media access follows wiki visibility, not edit permissions.
export function canReadWikiMedia(viewer) {
  return viewer?.canView === true;
}

export function canEditWikiMediaMetadata(viewer, account, uploadedByEmail) {
  const requester = String(account?.email || "").trim().toLowerCase();
  const uploader = String(uploadedByEmail || "").trim().toLowerCase();
  return Boolean(viewer?.canEdit && (
    viewer.isAssignedStaff || (requester && uploader && requester === uploader)
  ));
}
