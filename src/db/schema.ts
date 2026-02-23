import { pgTable, uuid, date, varchar, numeric } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  vendor: varchar('vendor').notNull(),
  name: varchar('name').notNull(),
  amount: numeric('amount').notNull(),
  unit: varchar('unit').notNull(),
  price: numeric('price').notNull(),
  category: varchar('category').notNull(),
  totalPrice: numeric('total_price').notNull(),
});

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
});
