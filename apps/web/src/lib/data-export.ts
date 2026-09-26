// One module's share of a user's data export (docs/adr/0027): table name as
// it is in the database, then that user's rows.
export type DataExportTables = Record<string, readonly object[]>;
