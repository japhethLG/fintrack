import { describe, expect, it, vi } from "vitest";
import { renderApp, screen, waitFor, within, makeManualTransaction } from "../harness";

vi.setConfig({ testTimeout: 60_000 });

/** MANUAL-g / h / i: sign-up validation, Google-only accounts in Settings, Delete Account retry. */

const fillSignup = async (
  app: Awaited<ReturnType<typeof renderApp>>,
  { password, confirm }: { password: string; confirm: string }
) => {
  await app.user.type(screen.getByLabelText("Email"), "new@example.com");
  await app.user.type(screen.getByLabelText("Password"), password);
  await app.user.type(screen.getByLabelText("Confirm Password"), confirm);
  await app.user.click(screen.getByRole("button", { name: "Sign Up" }));
};

describe("MANUAL-g: sign-up asks twice and checks the length", () => {
  it("a password shorter than 6 characters is refused with a clear message, and nothing is sent", async () => {
    const app = await renderApp({ route: "/signup", user: null });
    await fillSignup(app, { password: "12345", confirm: "12345" });
    expect(await screen.findByText("Password must be at least 6 characters.")).toBeInTheDocument();
    expect(app.auth.__callsTo("createUserWithEmailAndPassword")).toHaveLength(0);
    expect(app.router.push).not.toHaveBeenCalled();
  });

  it("two different entries are refused: 'Passwords do not match.'", async () => {
    const app = await renderApp({ route: "/signup", user: null });
    await fillSignup(app, { password: "hunter22", confirm: "hunter23" });
    expect(await screen.findByText("Passwords do not match.")).toBeInTheDocument();
    expect(app.auth.__callsTo("createUserWithEmailAndPassword")).toHaveLength(0);
  });

  it("exactly 6 matching characters is accepted", async () => {
    const app = await renderApp({ route: "/signup", user: null });
    await fillSignup(app, { password: "abcdef", confirm: "abcdef" });
    await waitFor(() => expect(app.auth.__callsTo("createUserWithEmailAndPassword")).toHaveLength(1));
    expect(app.auth.__callsTo("createUserWithEmailAndPassword")[0].args).toEqual(["new@example.com", "abcdef"]);
  });
});

describe("MANUAL-h: a Google-only account has no password to change", () => {
  const google = { providerData: [{ providerId: "google.com" }] } as never;

  it("Settings offers no password change (and says why); email accounts still do", async () => {
    await renderApp({ route: "/settings", user: google });
    expect(screen.queryByText("Update Password")).toBeNull();
    expect(await screen.findByText(/no password to change/)).toBeInTheDocument();
    // the only "Change" button left would be the e-mail's, which is Google's to manage too
    expect(screen.queryAllByRole("button", { name: /Change/ })).toHaveLength(0);
  });

  it("an email/password account keeps both Change buttons", async () => {
    await renderApp({ route: "/settings" });
    expect(screen.getAllByRole("button", { name: /Change/ })).toHaveLength(2);
    expect(screen.queryByText(/no password to change/)).toBeNull();
  });
});

describe("MANUAL-i: a wrong password keeps the Delete Account dialog open", () => {
  it("shows the error inside the dialog, keeps what was typed, and a corrected retry deletes the account", async () => {
    const app = await renderApp({
      route: "/settings",
      today: "2026-01-15",
      seed: { transactions: [makeManualTransaction({ id: "t", scheduledDate: "2026-01-10" })] },
    });
    await app.user.click(screen.getAllByRole("button", { name: "Delete Account" }).at(-1)!);
    const dialog = await screen.findByRole("dialog");
    await within(dialog).findByText(/permanently delete your account/);
    await app.user.type(within(dialog).getByPlaceholderText(/Type "test@example.com"/), "test@example.com");
    const password = within(dialog).getByLabelText("Current password") as HTMLInputElement;
    await app.user.type(password, "wrong-one");

    app.auth.__failNext("reauthenticateWithCredential", new Error("Firebase: Error (auth/wrong-password)."));
    await app.user.click(within(dialog).getByRole("button", { name: "Delete My Account" }));

    // still open, with the error in it, and nothing was deleted
    expect(await within(dialog).findByText(/Incorrect password\. Nothing was deleted\./)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBe(dialog);
    expect(app.auth.__callsTo("deleteUser")).toHaveLength(0);
    expect(app.store.__get("users", "user-1")).toBeDefined();
    // what the user typed is still there
    expect((within(dialog).getByPlaceholderText(/Type "test@example.com"/) as HTMLInputElement).value).toBe("test@example.com");
    expect(password.value).toBe("wrong-one");
    // the button is usable again
    const retry = within(dialog).getByRole("button", { name: "Delete My Account" });
    expect(retry).toBeEnabled();

    // correct it and retry
    await app.user.clear(password);
    await app.user.type(password, "right-one");
    await app.user.click(retry);
    await waitFor(() => expect(app.auth.__callsTo("deleteUser")).toHaveLength(1));
    expect(app.router.push).toHaveBeenCalledWith("/login");
  });
});
