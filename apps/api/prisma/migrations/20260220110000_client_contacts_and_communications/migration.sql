-- CreateTable: contactos del cliente
CREATE TABLE "client_contacts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: comunicaciones del expediente
CREATE TABLE "matter_communications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "matter_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject" TEXT,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "user_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "matter_communications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "client_contacts_organization_id_idx" ON "client_contacts"("organization_id");
CREATE INDEX "client_contacts_client_id_idx" ON "client_contacts"("client_id");

CREATE INDEX "matter_communications_organization_id_idx" ON "matter_communications"("organization_id");
CREATE INDEX "matter_communications_matter_id_idx" ON "matter_communications"("matter_id");
CREATE INDEX "matter_communications_organization_id_matter_id_idx" ON "matter_communications"("organization_id", "matter_id");

ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_contacts" ADD CONSTRAINT "client_contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "matter_communications" ADD CONSTRAINT "matter_communications_matter_id_fkey" FOREIGN KEY ("matter_id") REFERENCES "matters"("id") ON DELETE CASCADE ON UPDATE CASCADE;
