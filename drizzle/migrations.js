// This file is required for Expo/React Native SQLite migrations - https://orm.drizzle.team/quick-sqlite/expo

import journal from './meta/_journal.json';
import m0000 from './0000_init.sql';
import m0001 from './0001_recurring_occurrences.sql';
import m0002 from './0002_budget_alerted.sql';
import m0003 from './0003_device_state.sql';
import m0004 from './0004_sign_out_and_plan.sql';
import m0005 from './0005_person_currency.sql';
import m0006 from './0006_offset_group.sql';
import m0007 from './0007_signed_out_user.sql';
import m0008 from './0008_tours_seen.sql';
import m0009 from './0009_guest_reminder.sql';
import m0010 from './0010_backup_problem.sql';
import m0011 from './0011_charges_back.sql';
import m0012 from './0012_enter_arrived.sql';

  export default {
    journal,
    migrations: {
      m0000,
m0001,
m0002,
m0003,
m0004,
m0005,
m0006,
m0007,
m0008,
m0009,
m0010,
m0011,
m0012
    }
  }
  