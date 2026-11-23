const bcrypt = require('bcryptjs');

function createPasswordService(rounds = 12) {
  async function hash(plainPassword) {
    return bcrypt.hash(plainPassword, rounds);
  }

  async function verify(plainPassword, passwordHash) {
    if (!passwordHash) {
      return false;
    }
    return bcrypt.compare(plainPassword, passwordHash);
  }

  return { hash, verify };
}

module.exports = { createPasswordService };
