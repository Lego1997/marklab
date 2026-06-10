import SwiftUI

/// Liquid Glass surface styling that gracefully degrades on macOS 14–25.
///
/// On macOS 26+ these route through the system `glassEffect(_:in:)` material so
/// surfaces pick up the platform's Liquid Glass look. On earlier systems they
/// fall back to the closest `Material` backing in the same continuous-corner
/// shape, preserving layout and spacing. The deployment target stays macOS 14.
enum LiquidGlass {
  /// Continuous-corner shape shared by every glass surface.
  static func shape(cornerRadius: CGFloat) -> RoundedRectangle {
    RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
  }
}

/// A passive container surface (cards, panels, inspectors).
private struct GlassPanelModifier: ViewModifier {
  let cornerRadius: CGFloat

  func body(content: Content) -> some View {
    if #available(macOS 26.0, *) {
      content.glassEffect(.regular, in: LiquidGlass.shape(cornerRadius: cornerRadius))
    } else {
      content.background(.regularMaterial, in: LiquidGlass.shape(cornerRadius: cornerRadius))
    }
  }
}

/// An interactive control surface (buttons, pills) that should feel tappable.
private struct GlassControlModifier: ViewModifier {
  let cornerRadius: CGFloat
  let tint: Color?

  func body(content: Content) -> some View {
    if #available(macOS 26.0, *) {
      var glass = Glass.regular.interactive()
      if let tint {
        glass = glass.tint(tint)
      }
      return AnyView(content.glassEffect(glass, in: LiquidGlass.shape(cornerRadius: cornerRadius)))
    } else {
      return AnyView(
        content
          .background(
            tint.map { $0.opacity(0.16) } ?? Color.clear,
            in: LiquidGlass.shape(cornerRadius: cornerRadius)
          )
          .background(.thinMaterial, in: LiquidGlass.shape(cornerRadius: cornerRadius))
      )
    }
  }
}

/// A lightweight surface for transient overlays (status pills).
private struct GlassSubtleModifier: ViewModifier {
  let cornerRadius: CGFloat

  func body(content: Content) -> some View {
    if #available(macOS 26.0, *) {
      content.glassEffect(.regular, in: LiquidGlass.shape(cornerRadius: cornerRadius))
    } else {
      content.background(.thinMaterial, in: LiquidGlass.shape(cornerRadius: cornerRadius))
    }
  }
}

extension View {
  /// Styles a passive container surface as Liquid Glass (macOS 26+) or a
  /// `.regularMaterial` panel on earlier systems.
  func glassPanel(cornerRadius: CGFloat = 12) -> some View {
    modifier(GlassPanelModifier(cornerRadius: cornerRadius))
  }

  /// Styles an interactive control as Liquid Glass (macOS 26+) or a tinted
  /// `.thinMaterial` backing on earlier systems.
  func glassControl(cornerRadius: CGFloat = 8, tint: Color? = nil) -> some View {
    modifier(GlassControlModifier(cornerRadius: cornerRadius, tint: tint))
  }

  /// Styles a transient overlay surface with a lightweight glass backing.
  func glassSubtle(cornerRadius: CGFloat = 6) -> some View {
    modifier(GlassSubtleModifier(cornerRadius: cornerRadius))
  }
}
