// One invite link (P14-01): whether a server invite may also create an
// account, decided in one place so sign-up, the public preview and the
// invite dialog always agree.
//
// The site's registration mode decides whether invites count at all:
//   open    — anyone can sign up (an invite still joins them to the server)
//   invite  — only with an invite link or a sign-up code ("code" before P14)
//   closed  — nobody, unless "Invite links still let people sign up" is on
// and "Who can bring in new people with their invites" decides whose invites:
//   site_admins   — invites made by a site admin (the default)
//   server_admins — made by that server's owner or someone who can edit it
//   inviters      — made by anyone the server's roles still let invite
// The creator is judged as they are *now*: demoted, suspended or gone, and
// their links stop creating accounts (they still let existing users join).
const db = require('../db');
const { registrationMode } = require('../config');

const WHO = ['site_admins', 'server_admins', 'inviters'];
const whoCanBringIn = () => (WHO.includes(db.getSetting('invites_create_accounts')) ? db.getSetting('invites_create_accounts') : 'site_admins');
const closedAllowsInvites = () => db.getSetting('closed_allows_invites') === '1';

// Whether the mode lets an invite create accounts at all.
function modeAllowsInvites(mode = registrationMode()) {
  if (mode === 'open' || mode === 'invite') return true;
  return mode === 'closed' && closedAllowsInvites();
}

// Whether this invite's creator may bring new people in, as things are now.
function creatorQualifies(invite) {
  const creator = invite && invite.created_by ? db.getUserById(invite.created_by) : null;
  if (!creator || creator.suspended_at || creator.is_bot) return false;
  const who = whoCanBringIn();
  if (who === 'site_admins') return !!creator.site_admin;
  const access = db.resolveAccess(invite.space_id, creator.id); // null once they've left
  if (!access) return false;
  if (who === 'server_admins') return !!(access.owner || access.actions.has('edit_server'));
  return access.actions.has('invite');
}

// Whether a usable invite (not expired or used up) can create an account now.
function inviteCanCreateAccount(invite) {
  if (!invite) return false;
  if (invite.expires_at && Date.now() > invite.expires_at) return false;
  if (invite.max_uses && invite.uses >= invite.max_uses) return false;
  return modeAllowsInvites() && creatorQualifies(invite);
}

module.exports = { WHO, whoCanBringIn, closedAllowsInvites, modeAllowsInvites, inviteCanCreateAccount };
