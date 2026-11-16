// T3 Code renders Word, Excel and PowerPoint files in workers of its own;
// kuru code leaves them to the system: the file opens in its own app.
import { FileSurfaceNotice } from "./fileSurfaceChrome";

export default function OpenXmlOfficeViewer(_props: { readonly [key: string]: unknown }) {
  return <FileSurfaceNotice>Open this file in its own app to read it.</FileSurfaceNotice>;
}
