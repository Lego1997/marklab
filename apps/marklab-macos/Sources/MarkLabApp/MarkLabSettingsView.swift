import AppKit
import AuthenticationServices
import MarkLabMacOS
import SwiftUI

enum MarkLabAppSettings {
  static let localAutosaveEnabledDefaultsKey = "MarkLabLocalAutosaveEnabled"
  static let localAutosaveLabel = "Autosave Local Files"
  static let localAutosaveDescription = "Only applies when a file is not sharing. Shared documents sync automatically and create online version checkpoints."
  static let accountSectionTitle = "Account"
  static let accountSignedOutDescription = "Sign in before sharing or opening shared documents in MarkLab.app."
  static let accountSignInPrompt = "Choose how you'd like to sign in. Continuing opens your browser to finish securely."
  static let signInLabel = "Sign In"
  static let signOutLabel = "Sign Out"
  static let continueWithGoogleLabel = "Continue with Google"
  static let continueWithMicrosoftLabel = "Continue with Microsoft"
  static let continueWithAppleBrowserLabel = "Continue with Apple (browser)"
}

struct MarkLabSettingsView: View {
  @AppStorage(MarkLabAppSettings.localAutosaveEnabledDefaultsKey)
  private var localAutosaveEnabled = false
  @State private var account: NativeStoredAccount?
  @State private var accountStatus: String?
  @State private var appleSignInCoordinator = AppleSignInCoordinator()
  private let accountStore: NativeAccountStore
  private let hostedDefaults: NativeHostedDefaults
  private let accountTransport: NativeHTTPTransport

  init(
    accountStore: NativeAccountStore = .defaultStore(),
    hostedDefaults: NativeHostedDefaults = .fromEnvironment(),
    accountTransport: NativeHTTPTransport = URLSessionNativeHTTPTransport()
  ) {
    self.accountStore = accountStore
    self.hostedDefaults = hostedDefaults
    self.accountTransport = accountTransport
    _account = State(initialValue: try? accountStore.load())
  }

  var body: some View {
    Form {
      Section(MarkLabAppSettings.accountSectionTitle) {
        if let account {
          signedInContent(account)
        } else {
          signedOutContent
        }
        if let accountStatus {
          Text(accountStatus)
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      Section("Editing") {
        Toggle(MarkLabAppSettings.localAutosaveLabel, isOn: $localAutosaveEnabled)
        Text(MarkLabAppSettings.localAutosaveDescription)
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
    .formStyle(.grouped)
    .padding(20)
    .frame(width: 440)
    .onReceive(NotificationCenter.default.publisher(for: .markLabAccountDidSignIn)) { _ in
      account = try? accountStore.load()
      if account != nil {
        accountStatus = "Signed in."
      }
    }
    .onReceive(NotificationCenter.default.publisher(for: .markLabAccountDidSignOut)) { notification in
      let token = notification.userInfo?[NativeAccountSignOutNotification.tokenKey] as? String
      if token == nil || token == account?.token {
        account = nil
        accountStatus = "Signed out."
      }
    }
  }

  @ViewBuilder
  private func signedInContent(_ account: NativeStoredAccount) -> some View {
    Text(account.displayName)
      .font(.headline)
    Text(account.email)
      .foregroundStyle(.secondary)
    Text(account.workspaceName)
      .foregroundStyle(.secondary)
    Button(MarkLabAppSettings.signOutLabel) {
      signOut()
    }
  }

  private var signedOutContent: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(MarkLabAppSettings.accountSignedOutDescription)
        .font(.callout)
        .foregroundStyle(.secondary)
      Text(MarkLabAppSettings.accountSignInPrompt)
        .font(.callout)
        .foregroundStyle(.secondary)

      VStack(spacing: 8) {
        providerButton(MarkLabAppSettings.continueWithGoogleLabel, systemImage: "globe")
        providerButton(MarkLabAppSettings.continueWithMicrosoftLabel, systemImage: "square.grid.2x2")
        providerButton(MarkLabAppSettings.continueWithAppleBrowserLabel, systemImage: "apple.logo")
      }

      Divider()

      AppleSignInButton {
        signInWithAppleNatively()
      }
      .frame(height: 32)
      .accessibilityLabel("Sign in with Apple")
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .padding(16)
    .glassPanel(cornerRadius: 12)
    .overlay {
      RoundedRectangle(cornerRadius: 12, style: .continuous)
        .stroke(Color(nsColor: .separatorColor).opacity(0.5), lineWidth: 1)
    }
  }

  private func providerButton(_ title: String, systemImage: String) -> some View {
    Button {
      NSWorkspace.shared.open(signInURL)
    } label: {
      Label(title, systemImage: systemImage)
        .frame(maxWidth: .infinity)
    }
    .controlSize(.large)
  }

  private var signInURL: URL {
    var components = URLComponents(url: hostedDefaults.webBaseURL.appending(path: "signin"), resolvingAgainstBaseURL: false)!
    let appState = NativeAuthPendingState.generate()
    try? accountStore.savePendingAuthState(appState)
    components.queryItems = [
      URLQueryItem(name: "native", value: "1"),
      URLQueryItem(name: "appState", value: appState),
    ]
    return components.url!
  }

  private func signInWithAppleNatively() {
    accountStatus = "Signing in with Apple..."
    appleSignInCoordinator.start(
      onSuccess: { credential in
        completeAppleNativeSignIn(credential)
      },
      onFailure: { error in
        handleAppleNativeFailure(error)
      }
    )
  }

  private func completeAppleNativeSignIn(_ credential: AppleSignInCoordinator.Credential) {
    Task { @MainActor in
      do {
        let result = try await NativeAccountClient.authenticateWithApple(
          apiBaseURL: hostedDefaults.apiBaseURL,
          identityToken: credential.identityToken,
          authorizationCode: credential.authorizationCode,
          fullName: credential.fullName,
          transport: accountTransport
        )
        let established = try await NativeAccountEstablishment.establish(
          token: result.token,
          apiBaseURL: hostedDefaults.apiBaseURL,
          webBaseURL: hostedDefaults.webBaseURL,
          accountStore: accountStore,
          transport: accountTransport
        )
        account = established
        accountStatus = "Signed in with Apple."
      } catch {
        accountStatus = "Couldn't finish Sign in with Apple. Opening the browser sign-in instead."
        NSWorkspace.shared.open(signInURL)
      }
    }
  }

  private func handleAppleNativeFailure(_ error: Error) {
    if let authError = error as? ASAuthorizationError, authError.code == .canceled {
      accountStatus = nil
      return
    }
    accountStatus = "Sign in with Apple isn't available here. Opening the browser sign-in instead."
    NSWorkspace.shared.open(signInURL)
  }

  private func signOut() {
    guard let currentAccount = account else {
      accountStatus = "Signed out."
      return
    }
    accountStatus = "Signing out..."
    Task { @MainActor in
      let client = NativeAccountClient(
        apiBaseURL: currentAccount.apiBaseURL,
        bearerToken: currentAccount.token,
        transport: accountTransport
      )
      let didLogout = (try? await client.logout()) != nil
      do {
        try accountStore.clear()
        account = nil
        accountStatus = didLogout ? "Signed out." : "Signed out locally. Server session may already be expired."
        NotificationCenter.default.post(
          name: .markLabAccountDidSignOut,
          object: nil,
          userInfo: [NativeAccountSignOutNotification.tokenKey: currentAccount.token]
        )
      } catch {
        accountStatus = "Unable to clear the local account."
      }
    }
  }
}
