function createFakeRepository() {
  const users = [];
  const donors = [];
  const donations = [];
  let sequence = 0;

  function newId() {
    sequence += 1;
    return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
  }

  function identityFor(user, donor) {
    return {
      userId: user.id,
      email: user.email,
      role: user.role,
      userCreatedAt: user.createdAt,
      donorId: donor.id,
      fullName: donor.fullName,
      phone: donor.phone,
      bloodType: donor.bloodType,
      dateOfBirth: donor.dateOfBirth,
      city: donor.city,
      donorCreatedAt: donor.createdAt
    };
  }

  return {
    users,
    donors,
    donations,
    async findUserByEmail(email) {
      return users.find((user) => user.email === String(email).toLowerCase()) || null;
    },
    async emailExists(email) {
      return users.some((user) => user.email === String(email).toLowerCase());
    },
    async createUserWithDonor(input) {
      const createdAt = new Date().toISOString();
      const user = {
        id: newId(),
        email: input.email,
        passwordHash: input.passwordHash,
        role: 'donor',
        createdAt
      };
      const donor = {
        id: newId(),
        userId: user.id,
        fullName: input.fullName,
        phone: input.phone,
        bloodType: input.bloodType,
        dateOfBirth: input.dateOfBirth,
        city: input.city,
        createdAt
      };
      users.push(user);
      donors.push(donor);
      return identityFor(user, donor);
    },
    async findIdentityByUserId(userId) {
      const user = users.find((item) => item.id === userId);
      if (!user) {
        return null;
      }
      const donor = donors.find((item) => item.userId === user.id);
      return donor ? identityFor(user, donor) : null;
    },
    async findIdentityByDonorId(donorId) {
      const donor = donors.find((item) => item.id === donorId);
      if (!donor) {
        return null;
      }
      const user = users.find((item) => item.id === donor.userId);
      return user ? identityFor(user, donor) : null;
    },
    async updateDonorProfile(donorId, input) {
      const donor = donors.find((item) => item.id === donorId);
      if (!donor) {
        return null;
      }
      Object.assign(donor, {
        fullName: input.fullName,
        phone: input.phone,
        bloodType: input.bloodType,
        dateOfBirth: input.dateOfBirth,
        city: input.city
      });
      return {
        donorId: donor.id,
        fullName: donor.fullName,
        phone: donor.phone,
        bloodType: donor.bloodType,
        dateOfBirth: donor.dateOfBirth,
        city: donor.city,
        donorCreatedAt: donor.createdAt
      };
    },
    async listDonations(donorId, limit = 100) {
      return donations
        .filter((donation) => donation.donorId === donorId)
        .sort((a, b) => Date.parse(b.donatedAt) - Date.parse(a.donatedAt))
        .slice(0, limit)
        .map((donation) => ({ ...donation }));
    },
    async getLastDonation(donorId) {
      const list = await this.listDonations(donorId, 1);
      return list[0] || null;
    },
    async getLastDonationBefore(donorId, before) {
      return donations
        .filter((donation) => donation.donorId === donorId && Date.parse(donation.donatedAt) <= Date.parse(before))
        .sort((a, b) => Date.parse(b.donatedAt) - Date.parse(a.donatedAt))
        .map((donation) => ({ donatedAt: donation.donatedAt }))[0] || null;
    },
    async insertDonation(input) {
      const donation = {
        id: newId(),
        donorId: input.donorId,
        donatedAt: input.donatedAt,
        location: input.location,
        amountMl: input.amountMl,
        createdAt: new Date().toISOString()
      };
      donations.push(donation);
      return { ...donation };
    },
    async checkDatabase() {
      return true;
    }
  };
}

function createSilentLogger() {
  return { debug() {}, info() {}, warn() {}, error() {} };
}

module.exports = { createFakeRepository, createSilentLogger };
