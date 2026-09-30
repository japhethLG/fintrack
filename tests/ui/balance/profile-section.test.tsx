import { describe, expect, it } from "vitest";
import { renderApp, screen, waitFor, knownDefect, makeFakeUser } from "../harness";

/**
 * Settings > Profile: display name, e-mail and password. The fake `firebase/auth` records
 * every SDK call, so ordering (re-authenticate BEFORE changing anything) is observable.
 */

const profile = (app: { store: { __get: <T>(c: string, id: string) => T | undefined } }) =>
  app.store.__get<{ displayName: string; email: string }>("users", "user-1")!;

const editRow = async (app: Awaited<ReturnType<typeof renderApp>>, label: RegExp) => {
  // the three rows have "Edit"/"Change" buttons in document order: name, e-mail, password
  await app.user.click(label.test("name") ? screen.getByRole("button", { name: /Edit/ }) : screen.getAllByRole("button", { name: /Change/ })[label.test("email") ? 0 : 1]);
};

describe("display name", () => {
  it("is saved trimmed, confirmed on screen, and shown in place of the old name", async () => {
    const app = await renderApp({ route: "/settings", seed: { profile: { displayName: "Old Name" } } });
    await editRow(app, /name/);
    const input = screen.getByPlaceholderText("Enter your display name");
    await app.user.clear(input);
    await app.user.type(input, "   Grace Hopper  ");
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Display name updated successfully!")).toBeInTheDocument();
    expect(profile(app).displayName).toBe("Grace Hopper");
    await waitFor(() => expect(screen.getByText("Grace Hopper")).toBeInTheDocument());
    expect(screen.queryByText("Old Name")).not.toBeInTheDocument();
  });

  it("an empty name is refused and Cancel restores the stored one", async () => {
    const app = await renderApp({ route: "/settings", seed: { profile: { displayName: "Old Name" } } });
    await editRow(app, /name/);
    await app.user.clear(screen.getByPlaceholderText("Enter your display name"));
    await app.user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Display name is required")).toBeInTheDocument();
    expect(app.store.__opsFor("users")).toEqual([]);
    await app.user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Old Name")).toBeInTheDocument();
  });

  knownDefect(
    "UI-BAL-41",
    "a whitespace-only display name passes validation and is saved as an EMPTY name",
    async () => {
      // observed: users/user-1.displayName === "" and the row reads "Not set"
      const app = await renderApp({ route: "/settings", seed: { profile: { displayName: "Old Name" } } });
      await editRow(app, /name/);
      const input = screen.getByPlaceholderText("Enter your display name");
      await app.user.clear(input);
      await app.user.type(input, "     ");
      await app.user.click(screen.getByRole("button", { name: "Save" }));
      await app.settle();
      // precondition: the save button was really pressed (either a message or a write followed)
      await waitFor(() =>
        expect(
          screen.queryByText("Display name is required") ?? screen.queryByText("Display name updated successfully!")
        ).not.toBeNull()
      );
      expect(profile(app).displayName).toBe("Old Name");
    }
  );
});

describe("e-mail change", () => {
  const fill = async (app: Awaited<ReturnType<typeof renderApp>>, email: string, password: string) => {
    await editRow(app, /email/);
    await app.user.type(screen.getByPlaceholderText("Enter new email"), email);
    await app.user.type(screen.getByPlaceholderText("Enter current password to confirm"), password);
    await app.user.click(screen.getByRole("button", { name: "Update Email" }));
  };

  it("re-authenticates first, then changes the auth e-mail, then the profile document", async () => {
    const app = await renderApp({ route: "/settings", user: { email: "old@example.com" }, seed: { profile: { email: "old@example.com" } } });
    await fill(app, "  new@example.com ", "s3cret!!");
    expect(await screen.findByText("Email updated successfully!")).toBeInTheDocument();
    expect(app.auth.__calls.map((c) => c.fn)).toEqual(["reauthenticateWithCredential", "updateEmail"]);
    expect(app.auth.__callsTo("reauthenticateWithCredential")[0].args[0]).toMatchObject({ email: "old@example.com", password: "s3cret!!" });
    expect(app.auth.__callsTo("updateEmail")[0].args).toEqual(["new@example.com"]);
    expect(profile(app).email).toBe("new@example.com");
  });

  it("a wrong password stops everything: no e-mail change anywhere, and the message says why", async () => {
    const app = await renderApp({ route: "/settings", user: { email: "old@example.com" }, seed: { profile: { email: "old@example.com" } } });
    app.auth.__failNext("reauthenticateWithCredential", new Error("Firebase: Error (auth/invalid-credential)."));
    await fill(app, "new@example.com", "wrong");
    expect(await screen.findByText("Current password is incorrect.")).toBeInTheDocument();
    expect(app.auth.__callsTo("updateEmail")).toEqual([]);
    expect(profile(app).email).toBe("old@example.com");
    expect(app.store.__opsFor("users")).toEqual([]);
  });

  it("an address already in use is reported in words and the profile keeps the old e-mail", async () => {
    const app = await renderApp({ route: "/settings", user: { email: "old@example.com" }, seed: { profile: { email: "old@example.com" } } });
    app.auth.__failNext("updateEmail", new Error("Firebase: Error (auth/email-already-in-use)."));
    await fill(app, "taken@example.com", "s3cret!!");
    expect(await screen.findByText("This email is already in use by another account.")).toBeInTheDocument();
    expect(profile(app).email).toBe("old@example.com");
  });

  it("an invalid address never reaches the SDK (the browser's own type=email check stops the submit)", async () => {
    const app = await renderApp({ route: "/settings" });
    await fill(app, "not-an-email", "s3cret!!");
    await app.settle();
    expect(app.auth.__calls).toEqual([]);
    expect(app.store.__opsFor("users")).toEqual([]);
    expect(screen.queryByText("Email updated successfully!")).not.toBeInTheDocument();
  });
});

describe("password change", () => {
  const fill = async (app: Awaited<ReturnType<typeof renderApp>>, current: string, next: string, confirm: string) => {
    await editRow(app, /password/);
    await app.user.type(screen.getByPlaceholderText("Current password"), current);
    await app.user.type(screen.getByPlaceholderText(/New password/), next);
    await app.user.type(screen.getByPlaceholderText("Confirm new password"), confirm);
    await app.user.click(screen.getByRole("button", { name: "Update Password" }));
  };

  it("re-authenticates, then updates the password, and never writes the password to the database", async () => {
    const app = await renderApp({ route: "/settings" });
    await fill(app, "old-pass", "new-pass-1", "new-pass-1");
    expect(await screen.findByText("Password updated successfully!")).toBeInTheDocument();
    expect(app.auth.__calls.map((c) => c.fn)).toEqual(["reauthenticateWithCredential", "updatePassword"]);
    expect(app.auth.__callsTo("updatePassword")[0].args).toEqual(["new-pass-1"]);
    expect(JSON.stringify(app.store.__all("users"))).not.toContain("new-pass-1");
    expect(JSON.stringify(app.store.__all("users"))).not.toContain("old-pass");
  });

  it("a mismatched confirmation and a too-short password are rejected before any SDK call", async () => {
    const app = await renderApp({ route: "/settings" });
    await fill(app, "old-pass", "new-pass-1", "new-pass-2");
    expect(await screen.findByText("Passwords do not match")).toBeInTheDocument();
    expect(app.auth.__calls).toEqual([]);
    await app.user.click(screen.getByRole("button", { name: "Cancel" }));
    await fill(app, "old-pass", "abc", "abc");
    expect(await screen.findByText("Password must be at least 6 characters")).toBeInTheDocument();
    expect(app.auth.__calls).toEqual([]);
  });

  it("a stale session is told to re-enter the password", async () => {
    const app = await renderApp({ route: "/settings" });
    app.auth.__failNext("updatePassword", new Error("Firebase: Error (auth/requires-recent-login)."));
    await fill(app, "old-pass", "new-pass-1", "new-pass-1");
    expect(await screen.findByText("Please enter your current password to make this change.")).toBeInTheDocument();
  });
});

describe("edit rows are exclusive", () => {
  it("opening one editor closes another and discards its draft", async () => {
    const app = await renderApp({ route: "/settings", seed: { profile: { displayName: "Old Name" } } });
    await editRow(app, /name/);
    await app.user.type(screen.getByPlaceholderText("Enter your display name"), "X");
    await editRow(app, /email/);
    expect(screen.queryByPlaceholderText("Enter your display name")).not.toBeInTheDocument();
    expect(screen.getByPlaceholderText("Enter new email")).toBeInTheDocument();
    expect(profile(app).displayName).toBe("Old Name");
  });

  it("the sidebar shows the profile's display name in preference to the auth account's", async () => {
    await renderApp({ route: "/settings", layout: true, seed: { profile: { displayName: "Profile Name" } }, user: makeFakeUser({ displayName: "Auth Name" }) });
    expect(screen.getAllByText("Profile Name").length).toBeGreaterThan(0);
    expect(screen.queryByText("Auth Name")).not.toBeInTheDocument();
  });
});
