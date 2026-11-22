// Server-safe storage helpers without React imports, so Next.js Route Handlers
// and non-React backends can import them under the `react-server` condition.
export { applyChanges, RecordUnreadableError } from "waymark-core";
export type { RecordChanges, StoredRecord } from "waymark-core";
