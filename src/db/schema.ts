import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const notes = sqliteTable('notes', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  date: text('date').notNull(),
  vendor: text('vendor').notNull(),
  name: text('name').notNull(),
  amount: integer('amount').notNull(),
  unit: text('unit').notNull(),
  price: integer('price').notNull(),
  category: text('category').notNull(),
  totalPrice: integer('total_price').notNull(),
  status: text('status').notNull().default('pending'),
});

export const userTable = sqliteTable('users', {
  id: text('id')
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  username: text('username', { length: 100 }).notNull(),
  email: text('email', { length: 255 }).notNull().unique(),
  password: text('password', { length: 255 }).notNull(),
});
