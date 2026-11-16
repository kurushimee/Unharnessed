// From T3 Code's components/files/AttachmentFilePreview.tsx. kuru code sends images only, so
// its file preview is gone; the read-only source view stays for a review comment's diff.
import { lazy, Suspense } from "react";

import { FileSurfaceLoading } from "./fileSurfaceChrome";

const SourcePreview = lazy(() => import("./ReadOnlySourcePreview"));

export function ReadOnlySourcePreview(props: { name: string; text: string; wordWrap?: boolean }) {
  return (
    <Suspense fallback={<FileSurfaceLoading className="p-4" />}>
      <SourcePreview {...props} />
    </Suspense>
  );
}
