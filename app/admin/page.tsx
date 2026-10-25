/** Self-contained operations page. No process metadata is server-rendered.
 * Authentication is enforced by every /api/admin route, not by a hidden div.
 */
export default function AdminPage() {
  return (
    <main className="page admin" data-admin>
      <div className="page-head admin__heading">
        <div>
          <h1 className="page-title">Operations</h1>
          <p className="page-lede">Processes, logs and launch-worker health.</p>
        </div>
        <button className="btn" id="admin-sign-out" type="button" hidden>
          Sign out
        </button>
      </div>

      <section className="panel admin__login" id="admin-login" hidden>
        <div className="panel__head">
          <b>Administrator access</b>
        </div>
        <form id="admin-login-form" className="panel__body admin__login-form">
          <label htmlFor="admin-password">Administrator password</label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            minLength={20}
            spellCheck={false}
          />
          <button className="btn btn--primary" type="submit">
            Sign in
          </button>
          <p
            id="admin-login-message"
            className="admin__message"
            role="status"
            aria-live="polite"
          ></p>
        </form>
      </section>

      <section className="panel" id="admin-unavailable" hidden>
        <div className="panel__body">
          <p>Administrator access is not configured for this deployment.</p>
        </div>
      </section>

      <div className="admin__workspace" id="admin-workspace" hidden>
        <section className="admin__status-grid" aria-label="Operational status">
          <div className="panel admin__metric">
            <span className="label">Managed processes</span>
            <b id="admin-process-count">—</b>
            <span id="admin-running-count" className="admin__secondary"></span>
          </div>
          <div className="panel admin__metric">
            <span className="label">Launch worker</span>
            <b id="admin-worker-state">Checking</b>
            <span id="admin-worker-detail" className="admin__secondary"></span>
          </div>
          <div className="panel admin__metric">
            <span className="label">Deployment readiness</span>
            <b id="admin-readiness">Checking</b>
            <span
              id="admin-readiness-detail"
              className="admin__secondary"
            ></span>
          </div>
        </section>

        <div className="admin__split">
          <section
            className="panel admin__process-panel"
            aria-labelledby="admin-processes-title"
          >
            <div className="panel__head admin__toolbar">
              <h2 className="section-title" id="admin-processes-title">
                Processes
              </h2>
              <button
                type="button"
                className="btn admin__small"
                id="admin-refresh"
              >
                Refresh
              </button>
            </div>
            <div className="admin__search">
              <label htmlFor="admin-filter" className="sr-only">
                Filter processes
              </label>
              <input
                id="admin-filter"
                type="search"
                placeholder="Filter by process name"
                autoComplete="off"
              />
            </div>
            <div className="table-wrap admin__table-wrap">
              <table className="table admin__table">
                <thead>
                  <tr>
                    <th>Process</th>
                    <th>Status</th>
                    <th className="num">PID</th>
                    <th className="num">Port</th>
                  </tr>
                </thead>
                <tbody id="admin-process-rows">
                  <tr>
                    <td colSpan={4}>Loading processes…</td>
                  </tr>
                </tbody>
              </table>
            </div>
            <p
              className="admin__footnote"
              id="admin-process-message"
              role="status"
            ></p>
          </section>

          <section
            className="panel admin__detail"
            aria-labelledby="admin-detail-title"
          >
            <div className="panel__head admin__toolbar">
              <div>
                <h2 className="section-title" id="admin-detail-title">
                  Process details
                </h2>
                <span className="admin__secondary" id="admin-selected-status">
                  Choose a process to inspect it.
                </span>
              </div>
              <div className="admin__controls" id="admin-actions" hidden>
                <button
                  className="btn admin__small"
                  data-admin-action="restart"
                  type="button"
                >
                  Restart
                </button>
                <button
                  className="btn admin__small"
                  data-admin-action="stop"
                  type="button"
                >
                  Stop
                </button>
                <button
                  className="btn admin__small admin__danger"
                  data-admin-action="delete"
                  type="button"
                >
                  Delete
                </button>
              </div>
            </div>
            <div className="admin__log-controls">
              <span className="admin__log-heading">Logs</span>
              <label className="admin__autoscroll">
                <input type="checkbox" id="admin-follow" defaultChecked />{" "}
                Follow
              </label>
              <button
                type="button"
                className="btn admin__small"
                id="admin-pause"
              >
                Pause
              </button>
            </div>
            <div className="admin__log-filter">
              <label htmlFor="admin-log-search" className="sr-only">
                Search log lines
              </label>
              <input
                id="admin-log-search"
                type="search"
                placeholder="Search log lines"
                autoComplete="off"
              />
              <span id="admin-stream-status" role="status" aria-live="polite">
                Not connected
              </span>
            </div>
            <div className="admin__log-streams">
              <section className="admin__log-stream" aria-labelledby="admin-log-stdout-title">
                <h3 className="admin__log-title" id="admin-log-stdout-title">stdout</h3>
                <pre className="admin__logs" id="admin-log-stdout" tabIndex={0}>
                  Select a process to view its logs.
                </pre>
              </section>
              <section className="admin__log-stream admin__log-stream--err" aria-labelledby="admin-log-stderr-title">
                <h3 className="admin__log-title" id="admin-log-stderr-title">stderr</h3>
                <pre className="admin__logs" id="admin-log-stderr" tabIndex={0}>
                  Select a process to view its logs.
                </pre>
              </section>
            </div>
            <p
              className="admin__footnote"
              id="admin-action-message"
              role="status"
              aria-live="polite"
            ></p>
          </section>
        </div>
        <p className="admin__disclaimer">
          Process controls are limited to explicitly permitted names. Logs can
          contain sensitive operational information.
        </p>
      </div>
    </main>
  );
}
