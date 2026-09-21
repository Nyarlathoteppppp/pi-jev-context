// Observe upstream fallback reasons without generating another native summary.
import { pathToFileURL } from 'node:url';
export default async function(pi: any) {
 const { handleCompaction } = await import(pathToFileURL(process.env.WANG_HANDLER ?? '/tmp/pi-jev-compaction-mvp/src/extension.ts').href);
 pi.on('session_before_compact', async (event: any) => {
  const notes: string[] = [];
  const result = await handleCompaction(event, (message: string) => notes.push(message));
  pi.appendEntry('wang-probe', { notes, acted: !!result?.compaction });
  return { cancel: true };
 });
}
