// One module's share of a user's data export (docs/adr/0027): table name as
// it is in the database, then that user's rows. A module with many rows may
// yield them from a paged query instead of loading the whole table first.
export type DataExportTables = Record<string, readonly object[] | AsyncIterable<object>>;
