import { pgTable, uuid, date, varchar, integer } from 'drizzle-orm/pg-core';

export const notes = pgTable('notes', {
  id: uuid('id').primaryKey().defaultRandom(),
  date: date('date').notNull(),
  vendor: varchar('vendor').notNull(),
  name: varchar('name').notNull(),
  amount: integer('amount').notNull(),
  unit: varchar('unit').notNull(),
  price: integer('price').notNull(),
  category: varchar('category').notNull(),
  totalPrice: integer('total_price').notNull(),
  status: varchar('status').notNull().default('pending'),
});

export const userTable = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  username: varchar("username", { length: 100 }).notNull(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  password: varchar("password", { length: 255 }).notNull(),
});
