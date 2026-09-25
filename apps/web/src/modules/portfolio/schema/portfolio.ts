import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "../../auth/schema";

export const fillSides = ["buy", "sell"] as const;
export type FillSide = (typeof fillSides)[number];

export const assetClasses = ["stock", "option"] as const;
export type AssetClass = (typeof assetClasses)[number];

export const fillSources = ["manual", "b3_import", "settlement"] as const;
export type FillSource = (typeof fillSources)[number];

export const operationStatuses = ["open", "closed", "expired"] as const;
export type OperationStatus = (typeof operationStatuses)[number];

function inList(values: readonly string[]) {
  return sql.raw(values.map((value) => `'${value}'`).join(", "));
}

export const operations = pgTable(
  "operations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    underlying: text("underlying").notNull(),
    status: text("status").$type<OperationStatus>().notNull(),
    expiry: date("expiry", { mode: "string" }),
    openedAt: date("opened_at", { mode: "string" }).notNull(),
    closedAt: date("closed_at", { mode: "string" }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("operations_user_id_status_idx").on(table.userId, table.status),
    // Target of the fills' composite foreign key below: a fill's user_id is
    // bound to its operation's user_id by the database, not by discipline.
    uniqueIndex("operations_id_user_id_idx").on(table.id, table.userId),
    check("operations_status_check", sql`${table.status} in (${inList(operationStatuses)})`),
    check(
      "operations_closed_at_check",
      sql`(${table.status} = 'open') = (${table.closedAt} is null)`,
    ),
  ],
);

export const fills = pgTable(
  "fills",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    // Insertion order breaks ties between fills of the same session, which
    // decides average cost when a session's fills cross zero (ADR-0021).
    seq: integer("seq").generatedAlwaysAsIdentity().notNull(),
    ticker: text("ticker").notNull(),
    assetClass: text("asset_class").$type<AssetClass>().notNull(),
    side: text("side").$type<FillSide>().notNull(),
    quantity: integer("quantity").notNull(),
    price: numeric("price", { precision: 18, scale: 6, mode: "string" }).notNull(),
    session: date("session", { mode: "string" }).notNull(),
    costsCentavos: bigint("costs_centavos", { mode: "number" }).notNull().default(0),
    source: text("source").$type<FillSource>().notNull(),
    expiry: date("expiry", { mode: "string" }),
    importKey: text("import_key"),
    operationId: text("operation_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("fills_user_id_session_idx").on(table.userId, table.session),
    index("fills_operation_id_idx").on(table.operationId),
    uniqueIndex("fills_user_id_import_key_idx")
      .on(table.userId, table.importKey)
      .where(sql`${table.importKey} is not null`),
    foreignKey({
      columns: [table.operationId, table.userId],
      foreignColumns: [operations.id, operations.userId],
    }),
    check("fills_side_check", sql`${table.side} in (${inList(fillSides)})`),
    check("fills_asset_class_check", sql`${table.assetClass} in (${inList(assetClasses)})`),
    check("fills_source_check", sql`${table.source} in (${inList(fillSources)})`),
    check("fills_quantity_positive_check", sql`${table.quantity} > 0`),
    check("fills_price_non_negative_check", sql`${table.price} >= 0`),
    check("fills_costs_non_negative_check", sql`${table.costsCentavos} >= 0`),
    check(
      "fills_stock_has_no_expiry_check",
      sql`${table.assetClass} = 'option' or ${table.expiry} is null`,
    ),
  ],
);
