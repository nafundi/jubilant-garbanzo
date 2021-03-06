// Copyright 2017 ODK Central Developers
// See the NOTICE file at the top-level directory of this distribution and at
// https://github.com/opendatakit/central-backend/blob/master/NOTICE.
// This file is part of ODK Central. It is subject to the license terms in
// the LICENSE file found in the top-level directory of this distribution and at
// https://www.apache.org/licenses/LICENSE-2.0. No part of ODK Central,
// including this file, may be copied, modified, propagated, or distributed
// except according to the terms contained in the LICENSE file.

const { sql } = require('slonik');
const { map } = require('ramda');
const { Actor, Audit, Form, Project } = require('../frames');
const { extender, equals, page, QueryOptions } = require('../../util/db');
const Option = require('../../util/option');
const { construct } = require('../../util/util');


const log = (actor, action, actee, details) => ({ run }) => {
  const actorId = Option.of(actor).map((x) => x.id).orNull();
  const acteeId = Option.of(actee).map((x) => x.acteeId).orNull();
  const processed = Audit.actionableEvents.includes(action) ? null : sql`clock_timestamp()`;

  return run(sql`
insert into audits ("actorId", action, "acteeId", details, "loggedAt", processed, failures)
values (${actorId}, ${action}, ${acteeId}, ${(details == null) ? null : JSON.stringify(details)}, clock_timestamp(), ${processed}, 0)`);
};


// we explicitly use where..in with a known lookup for performance.
// TODO: some sort of central table for all these things, not here.
const actionCondition = (action) => {
  if (action === 'nonverbose')
    return sql`action not in ('submission.create', 'submission.attachment.update', 'backup')`;
  else if (action === 'user')
    return sql`action in ('user.create', 'user.update', 'user.delete', 'assignment.create', 'assignment.delete')`;
  else if (action === 'project')
    return sql`action in ('project.create', 'project.update', 'project.delete')`;
  else if (action === 'form')
    return sql`action in ('form.create', 'form.update', 'form.delete', 'form.attachment.update', 'form.update.draft.set', 'form.update.draft.delete', 'form.update.publish')`;
  else if (action === 'submission')
    return sql`action in ('submission.create', 'submission.attachment.update')`;

  return sql`action=${action}`;
};


// used entirely by tests only:
const getLatestByAction = (action) => ({ maybeOne }) =>
  maybeOne(sql`select * from audits where action=${action} order by "loggedAt" desc limit 1`)
    .then(map(construct(Audit)));


// filter condition fragment used below in _get.
const auditFilterer = (options) => {
  const result = [];
  options.ifArg('start', (start) => result.push(sql`"loggedAt" >= ${start}`));
  options.ifArg('end', (end) => result.push(sql`"loggedAt" <= ${end}`));
  options.ifArg('action', (action) => result.push(actionCondition(action)));
  return (result.length === 0) ? sql`true` : sql.join(result, sql` and `);
};

const _get = extender(Audit)(Option.of(Actor.alias('actor_actor', 'actorActor')), Option.of(Actor), Option.of(Form), Option.of(Form.Def), Option.of(Project))((fields, extend, options) => sql`
select ${fields} from audits
  ${extend|| sql`
    left outer join actors as actor_actor on actor_actor.id=audits."actorId"
    left outer join projects on projects."acteeId"=audits."acteeId"
    left outer join actors on actors."acteeId"=audits."acteeId"
    left outer join forms on forms."acteeId"=audits."acteeId"
    left outer join form_defs on form_defs.id=forms."currentDefId"`}
  where ${equals(options.condition)} and ${auditFilterer(options)}
  order by "loggedAt" desc, audits.id desc
  ${page(options)}`);
const get = (options = QueryOptions.none) => ({ all }) =>
  _get(all, options).then((rows) => {
    // we need to actually put the formdef inside the form.
    if (rows.length === 0) return rows;
    if (rows[0].aux.form === undefined) return rows; // not extended

    // TODO: better if we don't have to loop over all this data twice.
    return rows.map((row) => (row.aux.form.isDefined()
      ? row.withAux('form', row.aux.form.map((f) => f.withAux('def', row.aux.def)))
      : row));
  });


module.exports = { log, getLatestByAction, get };

