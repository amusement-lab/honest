CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"date" date NOT NULL,
	"vendor" varchar NOT NULL,
	"name" varchar NOT NULL,
	"amount" numeric NOT NULL,
	"unit" varchar NOT NULL,
	"price" numeric NOT NULL,
	"category" varchar NOT NULL,
	"total_price" numeric NOT NULL,
	"status" varchar DEFAULT '' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"username" varchar(100) NOT NULL,
	"email" varchar(255) NOT NULL,
	"password" varchar(255) NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
