import AppKit
import AuthenticationServices
import SwiftUI

/// Drives a native Sign in with Apple request through `ASAuthorizationController`.
///
/// `ASAuthorizationAppleIDProvider` is available on macOS 10.15+, so the API
/// needs no availability gate. Native Sign in with Apple still requires the
/// `com.apple.developer.applesignin` entitlement on a provisioned/signed build;
/// in an unsigned/ad-hoc dev build the request can fail. Failures are reported
/// through `onFailure` so the caller can degrade gracefully — never fatally.
@MainActor
final class AppleSignInCoordinator: NSObject, ASAuthorizationControllerDelegate, ASAuthorizationControllerPresentationContextProviding {
  /// Decoded fields from a successful Apple ID credential.
  struct Credential {
    let identityToken: String
    let authorizationCode: String?
    let fullName: String?
  }

  private var onSuccess: ((Credential) -> Void)?
  private var onFailure: ((Error) -> Void)?
  private var activeController: ASAuthorizationController?

  /// Starts the request. `onFailure` receives `ASAuthorizationError.canceled`
  /// when the user dismisses the sheet; callers should treat that as a no-op.
  func start(
    onSuccess: @escaping (Credential) -> Void,
    onFailure: @escaping (Error) -> Void
  ) {
    self.onSuccess = onSuccess
    self.onFailure = onFailure

    let request = ASAuthorizationAppleIDProvider().createRequest()
    request.requestedScopes = [.fullName, .email]
    let controller = ASAuthorizationController(authorizationRequests: [request])
    controller.delegate = self
    controller.presentationContextProvider = self
    activeController = controller
    controller.performRequests()
  }

  // MARK: - ASAuthorizationControllerDelegate

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithAuthorization authorization: ASAuthorization
  ) {
    defer { finish() }
    guard
      let credential = authorization.credential as? ASAuthorizationAppleIDCredential,
      let identityTokenData = credential.identityToken,
      let identityToken = String(data: identityTokenData, encoding: .utf8),
      !identityToken.isEmpty
    else {
      onFailure?(ASAuthorizationError(.failed))
      return
    }
    let authorizationCode = credential.authorizationCode.flatMap { String(data: $0, encoding: .utf8) }
    let fullName = credential.fullName.flatMap(Self.formattedName)
    onSuccess?(Credential(
      identityToken: identityToken,
      authorizationCode: authorizationCode,
      fullName: fullName
    ))
  }

  func authorizationController(
    controller: ASAuthorizationController,
    didCompleteWithError error: Error
  ) {
    defer { finish() }
    onFailure?(error)
  }

  // MARK: - ASAuthorizationControllerPresentationContextProviding

  func presentationAnchor(for controller: ASAuthorizationController) -> ASPresentationAnchor {
    NSApplication.shared.keyWindow
      ?? NSApplication.shared.windows.first { $0.isVisible }
      ?? NSApplication.shared.windows.first
      ?? ASPresentationAnchor()
  }

  // MARK: - Helpers

  private func finish() {
    activeController = nil
    onSuccess = nil
    onFailure = nil
  }

  /// Apple only supplies `fullName` on the very first authorization.
  static func formattedName(_ components: PersonNameComponents) -> String? {
    let formatted = PersonNameComponentsFormatter().string(from: components).trimmingCharacters(in: .whitespacesAndNewlines)
    return formatted.isEmpty ? nil : formatted
  }
}

/// Native Sign in with Apple button wrapping `ASAuthorizationAppleIDButton`.
///
/// `SignInWithAppleButton` (AuthenticationServices/SwiftUI) does not expose the
/// underlying `ASAuthorizationController`, so the documented manual-controller
/// flow uses this AppKit button instead.
struct AppleSignInButton: NSViewRepresentable {
  var action: () -> Void

  func makeNSView(context: Context) -> ASAuthorizationAppleIDButton {
    let button = ASAuthorizationAppleIDButton(type: .signIn, style: .black)
    button.cornerRadius = 8
    button.target = context.coordinator
    button.action = #selector(Coordinator.didTap)
    return button
  }

  func updateNSView(_ nsView: ASAuthorizationAppleIDButton, context: Context) {
    context.coordinator.action = action
  }

  func makeCoordinator() -> Coordinator {
    Coordinator(action: action)
  }

  @MainActor
  final class Coordinator: NSObject {
    var action: () -> Void

    init(action: @escaping () -> Void) {
      self.action = action
    }

    @objc func didTap() {
      action()
    }
  }
}
