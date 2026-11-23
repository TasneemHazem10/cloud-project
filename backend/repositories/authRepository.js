function createAuthRepository(sql) {
  async function findUserByEmail(email) {
    const rows = await sql`
      SELECT id, email, password_hash AS "passwordHash", role, created_at AS "createdAt"
      FROM users
      WHERE lower(email) = lower(${email})
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function emailExists(email) {
    const rows = await sql`
      SELECT 1 AS exists FROM users WHERE lower(email) = lower(${email}) LIMIT 1
    `;
    return rows.length > 0;
  }

  async function createUserWithDonor(input) {
    const rows = await sql`
      WITH new_user AS (
        INSERT INTO users (email, password_hash)
        VALUES (${input.email}, ${input.passwordHash})
        RETURNING id, email, role, created_at
      ), new_donor AS (
        INSERT INTO donors (user_id, full_name, phone, blood_type, date_of_birth, city)
        SELECT id, ${input.fullName}, ${input.phone}, ${input.bloodType}, ${input.dateOfBirth}, ${input.city}
        FROM new_user
        RETURNING id, user_id, full_name, phone, blood_type, date_of_birth, city, created_at
      )
      SELECT
        u.id AS "userId",
        u.email,
        u.role,
        u.created_at AS "userCreatedAt",
        d.id AS "donorId",
        d.full_name AS "fullName",
        d.phone,
        d.blood_type AS "bloodType",
        d.date_of_birth AS "dateOfBirth",
        d.city,
        d.created_at AS "donorCreatedAt"
      FROM new_user u
      JOIN new_donor d ON d.user_id = u.id
    `;
    return rows[0] || null;
  }

  async function findIdentityByUserId(userId) {
    const rows = await sql`
      SELECT
        u.id AS "userId",
        u.email,
        u.role,
        u.created_at AS "userCreatedAt",
        d.id AS "donorId",
        d.full_name AS "fullName",
        d.phone,
        d.blood_type AS "bloodType",
        d.date_of_birth AS "dateOfBirth",
        d.city,
        d.created_at AS "donorCreatedAt"
      FROM users u
      JOIN donors d ON d.user_id = u.id
      WHERE u.id = ${userId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function findIdentityByDonorId(donorId) {
    const rows = await sql`
      SELECT
        u.id AS "userId",
        u.email,
        u.role,
        u.created_at AS "userCreatedAt",
        d.id AS "donorId",
        d.full_name AS "fullName",
        d.phone,
        d.blood_type AS "bloodType",
        d.date_of_birth AS "dateOfBirth",
        d.city,
        d.created_at AS "donorCreatedAt"
      FROM users u
      JOIN donors d ON d.user_id = u.id
      WHERE d.id = ${donorId}
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function updateDonorProfile(donorId, input) {
    const rows = await sql`
      UPDATE donors
      SET
        full_name = ${input.fullName},
        phone = ${input.phone},
        blood_type = ${input.bloodType},
        date_of_birth = ${input.dateOfBirth},
        city = ${input.city},
        updated_at = now()
      WHERE id = ${donorId}
      RETURNING
        id AS "donorId",
        full_name AS "fullName",
        phone,
        blood_type AS "bloodType",
        date_of_birth AS "dateOfBirth",
        city,
        created_at AS "donorCreatedAt",
        updated_at AS "donorUpdatedAt"
    `;
    return rows[0] || null;
  }

  async function listDonations(donorId, limit = 100) {
    return sql`
      SELECT
        id,
        donor_id AS "donorId",
        donated_at AS "donatedAt",
        location,
        amount_ml AS "amountMl",
        created_at AS "createdAt"
      FROM donations
      WHERE donor_id = ${donorId}
      ORDER BY donated_at DESC, created_at DESC
      LIMIT ${limit}
    `;
  }

  async function getLastDonation(donorId) {
    const rows = await sql`
      SELECT donated_at AS "donatedAt"
      FROM donations
      WHERE donor_id = ${donorId}
      ORDER BY donated_at DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function getLastDonationBefore(donorId, before) {
    const rows = await sql`
      SELECT donated_at AS "donatedAt"
      FROM donations
      WHERE donor_id = ${donorId} AND donated_at <= ${before}
      ORDER BY donated_at DESC
      LIMIT 1
    `;
    return rows[0] || null;
  }

  async function insertDonation(input) {
    const rows = await sql`
      INSERT INTO donations (donor_id, donated_at, location, amount_ml)
      VALUES (${input.donorId}, ${input.donatedAt}, ${input.location}, ${input.amountMl})
      RETURNING
        id,
        donor_id AS "donorId",
        donated_at AS "donatedAt",
        location,
        amount_ml AS "amountMl",
        created_at AS "createdAt"
    `;
    return rows[0] || null;
  }

  async function checkDatabase() {
    await sql`SELECT 1 AS ok`;
    return true;
  }

  return {
    findUserByEmail,
    emailExists,
    createUserWithDonor,
    findIdentityByUserId,
    findIdentityByDonorId,
    updateDonorProfile,
    listDonations,
    getLastDonation,
    getLastDonationBefore,
    insertDonation,
    checkDatabase
  };
}

module.exports = { createAuthRepository };
